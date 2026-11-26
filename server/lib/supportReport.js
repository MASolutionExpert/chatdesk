// ═══════════════════════════════════════════════════════════════════════════
// Support performance report — pure aggregation layer.
//
// Deliberately driver-neutral and I/O-free: `server/db.js` fetches the raw
// rows (chats, messages, tickets, users, departments) from SQLite or
// PostgreSQL and hands them here; every metric is computed in plain JS so
// both database backends produce identical numbers.
//
// Metric definitions (all ranges inclusive, evaluated on UTC timestamps):
//   conversations        support chats of the department CREATED in the range
//   messages             messages AUTHORED in the range inside the department's
//                        chats (any chat age — activity-based, not cohort-based)
//   customerMessages /   split of `messages` by the author's role
//   staffMessages
//   ticketsOpened        ticket rows CREATED in the range
//   ticketsClosed        ticket rows CLOSED in the range
//   openTickets          tickets opened in the range that are still open
//   answered             conversations (created in range) whose LAST message
//                        was authored by staff
//   unanswered           conversations created in range NOT answered — the
//                        last message is the customer's, or nobody wrote yet
//   avgFirstResponseSeconds  mean of (first staff reply − ticket creation)
//                        over tickets created in range — shown BOTH per
//                        department (every ticket of the range) and per
//                        operator (their own tickets of the range).
//                        Unanswered tickets carry no first response yet and
//                        stay out of the average; a first reply written after
//                        the window end still belongs to its in-range ticket
//                        ("the average of ALL tickets of the range").
//
// Operator attribution: a conversation is assigned to the operator recorded
// on its ticket row; legacy chats without a ticket row fall back to the
// author of the first staff reply. `messagesSent` counts every message the
// operator authored in the range inside the department's chats, while
// `messagesInConversations` / `customerMessages` count all in-range messages
// inside the conversations attributed to the operator, and `openTickets`
// counts their in-range tickets that are still open.
//
// OPERATOR RESPONSE TIME (`firstResponses` / `avgFirstResponseSeconds`):
// the classic helpdesk "first response time per ticket". A ticket (support
// conversation) created in the range contributes ONE sample — (first staff
// reply − ticket creation) — attributed to the operator who ACTUALLY wrote
// the first staff reply (their responsiveness is what the number measures).
// When the first reply's author is not on the department roster (a passing
// admin, a departed operator), the sample falls back to the ticket row's
// operator; legacy chats without a ticket row have no fallback and simply
// attribute to their first responder.
//
// ID KEYING (regression guard): since migration 036 the users / chats /
// chat_messages primary keys are TEXT UUIDs (departments keep INTEGER ids).
// Every map below therefore keys by String(id) — NEVER Number(id), which
// yields NaN for UUIDs and, because Maps match NaN via SameValueZero, would
// collapse every operator/chat/message onto a single "last row wins" bucket.
// ═══════════════════════════════════════════════════════════════════════════

const STAFF_ROLES = new Set(["operator", "owner"]);

// SQLite's `datetime('now')` yields "YYYY-MM-DD HH:MM:SS" (UTC, no zone);
// Postgres rows and newer SQLite writes carry ISO strings. Normalize both to
// epoch milliseconds so mixed-format columns compare correctly.
function parseTime(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  let text = String(value).trim();
  if (!text) return null;
  // "YYYY-MM-DD HH:MM:SS(.sss)" → treat as UTC (SQLite convention).
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)) {
    text = text.replace(" ", "T") + "Z";
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

// Accepts "YYYY-MM-DD" (expanded to a full UTC day) or a full ISO timestamp.
// Returns { fromMs, toMs } with null meaning "unbounded", or null when the
// input is invalid.
function expandRangeBound(value, kind) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const text = String(value).trim();
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (dayOnly) {
    const ms = Date.parse(`${text}T00:00:00Z`);
    if (Number.isNaN(ms)) return null;
    return kind === "from" ? ms : ms + 24 * 60 * 60 * 1000 - 1;
  }
  const ms = parseTime(text);
  if (ms === null) return null;
  return ms;
}

function resolveRange({ from, to } = {}) {
  const fromMs = expandRangeBound(from, "from");
  const toMs = expandRangeBound(to, "to");
  if (from !== undefined && from !== null && String(from).trim() !== "" && fromMs === null) {
    return null;
  }
  if (to !== undefined && to !== null && String(to).trim() !== "" && toMs === null) {
    return null;
  }
  return { fromMs, toMs };
}

function inRange(ms, range) {
  if (ms === null) return false;
  if (range.fromMs !== null && ms < range.fromMs) return false;
  if (range.toMs !== null && ms > range.toMs) return false;
  return true;
}

function newOperatorEntry(op) {
  return {
    id: op.id,
    username: op.username,
    nickname: op.nickname || op.username,
    color: op.color || null,
    role: op.role,
    assigned: 0,
    answered: 0,
    unanswered: 0,
    messagesInConversations: 0,
    customerMessages: 0,
    messagesSent: 0,
    firstResponses: 0,
    responseTimeTotalMs: 0,
    avgFirstResponseSeconds: null,
    ticketsOpened: 0,
    ticketsClosed: 0,
    openTickets: 0,
  };
}

/**
 * @param {object} input
 * @param {Array}  input.departments [{id, name, color, active}]
 * @param {Array}  input.operators   staff users with department_id set
 *                  [{id, username, nickname, color, role, department_id, banned}]
 * @param {Array}  input.chats       support chats [{id, department_id, created_at}]
 * @param {Array}  input.messages    [{chat_id, user_id, created_at}] (full history
 *                                   of the involved chats)
 * @param {Array}  input.users       [{id, role}] — author → role classification
 * @param {Array}  input.tickets     [{chat_id, department_id, operator_id, status,
 *                                   created_at, closed_at}]
 * @param {string|null} input.from   "YYYY-MM-DD" or ISO, inclusive
 * @param {string|null} input.to     "YYYY-MM-DD" or ISO, inclusive
 * @returns {object|null} null when from/to are invalid
 */
export function aggregateSupportReport({
  departments = [],
  operators = [],
  chats = [],
  messages = [],
  users = [],
  tickets = [],
  from = null,
  to = null,
} = {}) {
  const range = resolveRange({ from, to });
  if (!range) return null;

  // users.id is a TEXT UUID since migration 036 — key by String, not Number.
  const roleByUser = new Map(users.map((u) => [String(u.id), String(u.role || "user")]));
  const isStaffAuthor = (userId) =>
    STAFF_ROLES.has(roleByUser.get(String(userId)) || "user");

  // ── Operator-first department resolution (1.7.0-dev.8) ────────────────────
  // A ticket belongs to its customer↔operator pair; the department is only
  // the routing entry that grouped the operators. The department a chat or
  // ticket is REPORTED under is therefore resolved in order:
  //   1. its recorded department — while that department still exists;
  //   2. the CURRENT department of the ticket's operator (departments group
  //      operators, so the operator carries the orphaned ticket into their
  //      new department's report);
  //   3. otherwise null → the "removed departments" bucket (id: null), so
  //      deleting a department never erases its tickets from the history.
  const liveDeptIds = new Set(departments.map((dept) => Number(dept.id)));
  const operatorById = new Map(
    (operators || []).map((op) => [String(op.id), op])
  );

  // ── Index tickets per chat ────────────────────────────────────────────────
  const ticketByChat = new Map();
  for (const ticket of tickets || []) {
    if (ticket.chat_id !== null && ticket.chat_id !== undefined) {
      ticketByChat.set(String(ticket.chat_id), ticket); // chat ids are UUIDs
    }
  }

  const liveDept = (deptId) => (liveDeptIds.has(Number(deptId)) ? Number(deptId) : null);
  const effectiveDeptOfChat = (chat) => {
    const direct = liveDept(chat.department_id);
    if (direct !== null) return direct;
    const ticket = ticketByChat.get(String(chat.id));
    const operator = ticket ? operatorById.get(String(ticket.operator_id)) : null;
    return liveDept(operator?.department_id);
  };
  const effectiveDeptOfTicket = (ticket) => {
    const direct = liveDept(ticket.department_id);
    if (direct !== null) return direct;
    const operator = operatorById.get(String(ticket.operator_id));
    return liveDept(operator?.department_id);
  };

  // ── Index chats per department ────────────────────────────────────────────
  const chatsByDept = new Map();
  for (const dept of departments) {
    chatsByDept.set(Number(dept.id), []);
  }
  const orphanChats = []; // department gone AND operator has no live department
  for (const chat of chats) {
    const deptId = effectiveDeptOfChat(chat);
    if (deptId === null) orphanChats.push(chat);
    else chatsByDept.get(deptId).push(chat);
  }

  // ── Index messages per chat (full history) ────────────────────────────────
  const messagesByChat = new Map();
  for (const msg of messages || []) {
    const chatId = String(msg.chat_id); // chat ids are UUIDs — never Number()
    if (!messagesByChat.has(chatId)) messagesByChat.set(chatId, []);
    messagesByChat.get(chatId).push(msg);
  }
  for (const list of messagesByChat.values()) {
    list.sort((a, b) => {
      const ta = parseTime(a.created_at) ?? 0;
      const tb = parseTime(b.created_at) ?? 0;
      return ta - tb;
    });
  }

  // ── Index tickets per department (effective attribution) ──────────────────
  const ticketsByDept = new Map();
  for (const dept of departments) {
    ticketsByDept.set(Number(dept.id), []);
  }
  const orphanTickets = [];
  for (const ticket of tickets || []) {
    const deptId = effectiveDeptOfTicket(ticket);
    if (deptId === null) orphanTickets.push(ticket);
    else ticketsByDept.get(deptId).push(ticket);
  }

  // ── Operators per department (current assignment = the roster) ────────────
  const operatorsByDept = new Map();
  for (const op of operators || []) {
    if (op.department_id === null || op.department_id === undefined) continue;
    // departments.id stays INTEGER — Number() is safe here.
    const deptId = Number(op.department_id);
    if (!chatsByDept.has(deptId)) continue;
    if (!operatorsByDept.has(deptId)) operatorsByDept.set(deptId, []);
    operatorsByDept.get(deptId).push(op);
  }
  for (const list of operatorsByDept.values()) {
    list.sort((a, b) => String(a.username).localeCompare(String(b.username)));
  }

  // ── Per-department report builder ─────────────────────────────────────────
  // Shared by the live departments AND the "removed departments" bucket, so
  // orphaned tickets are measured with exactly the same metric definitions.
  const buildDeptReport = ({ deptId, name, color, active, deptChats, roster, deptTickets }) => {
    const totals = {
      conversations: 0,
      messages: 0,
      customerMessages: 0,
      staffMessages: 0,
      ticketsOpened: 0,
      ticketsClosed: 0,
      openTickets: 0,
      answered: 0,
      unanswered: 0,
      avgFirstResponseSeconds: null,
    };

    // users.id is a TEXT UUID — operator entries are keyed by String(op.id).
    // Number() would map EVERY operator to NaN, collapsing the roster into a
    // single "last operator wins" entry (the regression this guards against).
    const operatorEntries = new Map(
      (roster || []).map((op) => [String(op.id), newOperatorEntry(op)])
    );
    const entryFor = (userId) =>
      operatorEntries.get(String(userId)) || null;

    // ── Conversation → operator attribution (any chat age) ────────────────────
    // A chat belongs to its ticket's operator; legacy chats without a ticket
    // row fall back to the author of the first staff reply. Only operators on
    // the department roster receive attribution.
    const chatOperator = new Map(); // String(chatId) -> operator key
    for (const chat of deptChats) {
      const ticket = ticketByChat.get(String(chat.id));
      let opId = ticket && ticket.operator_id !== null && ticket.operator_id !== undefined
        ? String(ticket.operator_id)
        : null;
      if (opId === null) {
        const msgs = messagesByChat.get(String(chat.id)) || [];
        const firstStaffReply = msgs.find((m) => isStaffAuthor(m.user_id));
        if (firstStaffReply) opId = String(firstStaffReply.user_id);
      }
      if (opId !== null && operatorEntries.has(opId)) {
        chatOperator.set(String(chat.id), opId);
      }
    }

    // ── Conversations cohort (created in range) ─────────────────────────────
    let responseTimeTotalMs = 0;
    let responseChatCount = 0;
    for (const chat of deptChats) {
      const createdAt = parseTime(chat.created_at);
      const isCohort = inRange(createdAt, range);
      if (!isCohort) continue;

      totals.conversations += 1;

      const chatMessages = (messagesByChat.get(String(chat.id)) || []).slice();
      const lastMessage = chatMessages.length ? chatMessages[chatMessages.length - 1] : null;
      const lastAuthorStaff = lastMessage ? isStaffAuthor(lastMessage.user_id) : false;
      if (lastMessage && lastAuthorStaff) {
        totals.answered += 1;
      } else {
        totals.unanswered += 1;
      }

      // Conversation attribution follows the ticket's operator (legacy
      // no-ticket chats fall back to the first staff reply author, see
      // chatOperator above). Assigned / answered / unanswered AND the first
      // response sample below all ride the same attribution.
      const assignedOperatorId = chatOperator.get(String(chat.id)) ?? null;
      const opEntry = assignedOperatorId !== null ? entryFor(assignedOperatorId) : null;
      if (opEntry) opEntry.assigned += 1;

      if (opEntry) {
        if (lastMessage && lastAuthorStaff) opEntry.answered += 1;
        else opEntry.unanswered += 1;
      }

      // First response sample: (first staff reply − ticket creation). The
      // average of the range covers ALL tickets created in the range, so a
      // first reply written after the window end still counts for its
      // in-range ticket; only tickets that have not been answered yet
      // (no staff reply at all) stay out of the average.
      const firstStaffReply = chatMessages.find((m) => isStaffAuthor(m.user_id));
      if (firstStaffReply) {
        const firstReplyAt = parseTime(firstStaffReply.created_at);
        if (firstReplyAt !== null && createdAt !== null && firstReplyAt >= createdAt) {
          const delta = firstReplyAt - createdAt;
          responseTimeTotalMs += delta;
          responseChatCount += 1;
          // The first-response sample measures the responsiveness of the
          // operator who ACTUALLY answered first — whoever fair routing
          // assigned the ticket to. Only when that author is not on the
          // department roster does the sample fall back to the ticket's
          // recorded operator (opEntry above).
          const sampleEntry = entryFor(firstStaffReply.user_id) || opEntry;
          if (sampleEntry) {
            sampleEntry.firstResponses += 1;
            sampleEntry.responseTimeTotalMs += delta;
          }
        }
      }
    }
    totals.avgFirstResponseSeconds = responseChatCount
      ? Math.round((responseTimeTotalMs / responseChatCount) / 1000)
      : null;

    // ── Messages authored in range inside this department's chats ───────────
    const deptChatIdSet = new Set(deptChats.map((c) => String(c.id)));
    for (const [chatId, chatMessages] of messagesByChat) {
      if (!deptChatIdSet.has(chatId)) continue;
      const ownerEntry = chatOperator.has(chatId) ? entryFor(chatOperator.get(chatId)) : null;
      for (const msg of chatMessages) {
        const at = parseTime(msg.created_at);
        if (!inRange(at, range)) continue;
        totals.messages += 1;
        const authorIsStaff = isStaffAuthor(msg.user_id);
        if (authorIsStaff) {
          totals.staffMessages += 1;
          const opEntry = entryFor(msg.user_id);
          if (opEntry) opEntry.messagesSent += 1;
        } else {
          totals.customerMessages += 1;
        }
        // Per-operator conversation activity: every in-range message of a
        // chat counts for the operator that chat is attributed to.
        if (ownerEntry) {
          ownerEntry.messagesInConversations += 1;
          if (!authorIsStaff) ownerEntry.customerMessages += 1;
        }
      }
    }

    // ── Tickets (effective attribution — pre-bucketed by the caller) ────────
    for (const ticket of deptTickets || []) {
      const openedAt = parseTime(ticket.created_at);
      const closedAt = parseTime(ticket.closed_at);
      const openedInRange = inRange(openedAt, range);
      const closedInRange = inRange(closedAt, range);
      if (openedInRange) {
        totals.ticketsOpened += 1;
        if (String(ticket.status || "").toLowerCase() !== "closed") {
          totals.openTickets += 1;
        }
        const opEntry = ticket.operator_id !== null && ticket.operator_id !== undefined
          ? entryFor(String(ticket.operator_id))
          : null;
        if (opEntry) {
          opEntry.ticketsOpened += 1;
          if (String(ticket.status || "").toLowerCase() !== "closed") {
            opEntry.openTickets += 1;
          }
        }
      }
      if (closedInRange) {
        totals.ticketsClosed += 1;
        const opEntry = ticket.operator_id !== null && ticket.operator_id !== undefined
          ? entryFor(String(ticket.operator_id))
          : null;
        if (opEntry) opEntry.ticketsClosed += 1;
      }
    }

    const operatorList = Array.from(operatorEntries.values()).map((entry) => {
      const { responseTimeTotalMs, ...rest } = entry;
      rest.avgFirstResponseSeconds = entry.firstResponses
        ? Math.round(responseTimeTotalMs / entry.firstResponses / 1000)
        : null;
      return rest;
    });

    return {
      id: deptId,
      name,
      color,
      active,
      operatorCount: operatorList.length,
      totals,
      operators: operatorList,
    };
  };

  const departmentReports = [];
  for (const dept of departments) {
    const deptId = Number(dept.id);
    departmentReports.push(
      buildDeptReport({
        deptId,
        name: dept.name,
        color: dept.color || null,
        active: Boolean(Number(dept.active ?? 1)),
        deptChats: chatsByDept.get(deptId) || [],
        roster: operatorsByDept.get(deptId) || [],
        deptTickets: ticketsByDept.get(deptId) || [],
      })
    );
  }

  // Live departments sort by name; the removed-departments bucket (id: null,
  // name: null — the client renders a translated label) always sorts last.
  departmentReports.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  if (orphanChats.length || orphanTickets.length) {
    // Roster of the bucket: every staff member who owns an orphaned ticket
    // (or first-replied in an orphaned chat) and currently sits in NO live
    // department. Operators that moved to a live department never land here —
    // their tickets were already re-attributed to that department above.
    const orphanOperatorIds = new Set();
    for (const ticket of orphanTickets) {
      if (ticket.operator_id !== null && ticket.operator_id !== undefined) {
        orphanOperatorIds.add(String(ticket.operator_id));
      }
    }
    for (const chat of orphanChats) {
      const ticket = ticketByChat.get(String(chat.id));
      if (ticket && ticket.operator_id !== null && ticket.operator_id !== undefined) {
        orphanOperatorIds.add(String(ticket.operator_id));
        continue;
      }
      const msgs = messagesByChat.get(String(chat.id)) || [];
      const firstStaffReply = msgs.find((m) => isStaffAuthor(m.user_id));
      if (firstStaffReply) orphanOperatorIds.add(String(firstStaffReply.user_id));
    }
    const orphanRoster = Array.from(orphanOperatorIds)
      .map((id) => operatorById.get(id))
      .filter((op) => op && liveDept(op.department_id) === null)
      .sort((a, b) => String(a.username).localeCompare(String(b.username)));

    departmentReports.push(
      buildDeptReport({
        deptId: null,
        name: null,
        color: null,
        active: true,
        deptChats: orphanChats,
        roster: orphanRoster,
        deptTickets: orphanTickets,
      })
    );
  }

  return {
    range: {
      from: from || null,
      to: to || null,
    },
    departments: departmentReports,
  };
}

export { parseTime, resolveRange, expandRangeBound };
