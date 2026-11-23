/**
 * Helpdesk endpoints: department discovery + fair-routed support requests.
 *
 * A support request creates (or reuses) a support-channel DM chat between
 * the customer and the fairly-selected operator, tagged with the department
 * id — so the whole messenger stack (SSE, push, files, calls) keeps working
 * without any special casing.
 *
 * Two-logic separation (migration 044 + 045):
 *   - "direct"  : messenger chats opened by finding a user's ID. The route
 *     POST /api/chats/dm refuses customer↔staff pairs — those are tickets.
 *   - "support": helpdesk threads opened through the department picker, each
 *     registered in the `tickets` table (customer, department, operator,
 *     open/closed lifecycle). A support request NEVER reuses or converts a
 *     direct chat between the same pair; it only continues an existing
 *     support thread for the SAME department (and reopens its closed ticket).
 */
function registerDepartmentRoutes(app, deps) {
  const {
    requireSession,
    requireSessionUsernameMatch,
    listDepartments,
    getDepartmentById,
    pickOperatorForDepartment,
    findDmChat,
    createChat,
    addChatMember,
    createMessage,
    markChatDepartment,
    unhideChat,
    findUserByUsername,
    emitChatEvent,
    emitSseEvent,
    sendPushNotificationToUsers,
    createTicketRow,
    getTicketByChatId,
    setTicketStatusByChatId,
    findChatById,
    getChatMemberRole,
  } = deps;

  const awaitMaybe = async (value) => await value;

  // ─── Active departments for the picker UI ───────────────────────────────────
  app.get("/api/departments", async (req, res) => {
    const session = await requireSession(req, res);
    if (!session) return;
    const departments = await awaitMaybe(listDepartments({ activeOnly: true }));
    res.json({ departments });
  });

  // ─── Create / continue a support conversation ───────────────────────────────
  app.post("/api/support/request", async (req, res) => {
      const session = await requireSession(req, res);
      if (!session) return;

      const { departmentId, message, creator } = req.body || {};
      if (!departmentId) {
        return res.status(400).json({ error: "Department is required." });
      }
      if (!creator) {
        return res.status(400).json({ error: "Creator is required." });
      }
      if (!requireSessionUsernameMatch(res, session, creator)) return;

      const department = await awaitMaybe(getDepartmentById(departmentId));
      if (!department || !department.active) {
        return res.status(404).json({ error: "Department not found." });
      }

      const text = String(message || "").trim();
      if (!text) {
        return res.status(400).json({ error: "Message is required." });
      }
      if (text.length > 4000) {
        return res.status(400).json({ error: "Message is too long." });
      }

      const rawCustomer = findUserByUsername(String(creator).toLowerCase());
      const customer =
        rawCustomer && typeof rawCustomer.then === "function"
          ? await rawCustomer
          : rawCustomer;
      if (!customer) {
        return res.status(404).json({ error: "User not found." });
      }

      // Fair routing: fewest open conversations first, round-robin on ties.
      const operator = await awaitMaybe(
        pickOperatorForDepartment(department.id)
      );
      if (!operator) {
        return res.status(503).json({
          error:
            "No operator is available for this department right now. Please try again later.",
        });
      }

      // Reuse only an existing SUPPORT thread for the same department between
      // this customer and this operator. A direct (messenger) chat between the
      // pair is deliberately left alone — direct and support conversations
      // must stay separate, distinguishable threads.
      let chatId = await awaitMaybe(
        findDmChat(customer.id, operator.id, {
          channel: "support",
          departmentId: department.id,
        })
      );
      let reused = false;
      if (chatId) {
        reused = true;
        await awaitMaybe(unhideChat(customer.id, chatId));
        await awaitMaybe(unhideChat(operator.id, chatId));
      }

      if (!reused) {
        const rawChatId = await awaitMaybe(
          createChat(null, "dm", { channel: "support" })
        );
        chatId = rawChatId;
        if (!chatId) {
          return res.status(500).json({ error: "Failed to create chat." });
        }
        await awaitMaybe(addChatMember(chatId, customer.id, "owner"));
        await awaitMaybe(addChatMember(chatId, operator.id, "member"));
        await awaitMaybe(markChatDepartment(chatId, department.id));
      }

      // Ticket registry (migration 045): every support chat carries exactly
      // one ticket row that owns the lifecycle. New thread → new open ticket;
      // reused thread whose ticket was closed → reopened by this request.
      let ticket = await awaitMaybe(getTicketByChatId(chatId));
      if (!ticket) {
        await awaitMaybe(
          createTicketRow({
            chatId,
            departmentId: department.id,
            customerId: customer.id,
            operatorId: operator.id,
          })
        );
      } else if (ticket.status === "closed") {
        await awaitMaybe(setTicketStatusByChatId(chatId, "open"));
      }
      ticket = await awaitMaybe(getTicketByChatId(chatId));

      const messageId = await awaitMaybe(
        createMessage(chatId, customer.id, text)
      );

      // Realtime fan-out: message event for chat members + list change ping.
      await awaitMaybe(
        emitChatEvent(chatId, {
          type: "chat_message",
          chatId,
          messageId,
          username: customer.username,
          userId: customer.id,
          body: text,
          chatChannel: "support",
        })
      );
      await awaitMaybe(
        emitSseEvent(operator.username, {
          type: "chat_list_changed",
          chatId,
        })
      );
      await awaitMaybe(
        emitSseEvent(customer.username, {
          type: "chat_list_changed",
          chatId,
        })
      );
      if (typeof sendPushNotificationToUsers === "function") {
        void (async () => {
          try {
            await awaitMaybe(
              sendPushNotificationToUsers([operator.username], {
                title: customer.nickname || customer.username,
                body: text.slice(0, 200) || "New support message",
                data: { chatId },
              })
            );
          } catch {
            // push is best-effort
          }
        })();
      }

      return res.status(201).json({
        chatId,
        channel: "support",
        ticket: ticket
          ? { id: ticket.id, status: ticket.status }
          : { id: null, status: "open" },
        operator: {
          username: operator.username,
          nickname: operator.nickname || operator.username,
          color: operator.color || null,
        },
        department: { id: department.id, name: department.name },
      });
    }
  );

  // ─── Ticket lifecycle: close / reopen (members of the support chat only) ───
  //
  // Closing marks the work done (fair routing stops counting the ticket as
  // load; new messages are refused). Reopening restores the thread. Both
  // parties of the ticket — customer and staff member — may do either.
  async function handleTicketStatusChange(req, res, nextStatus) {
    const session = await requireSession(req, res);
    if (!session) return;

    const { creator } = req.body || {};
    const chatId = String(req.params.chatId || "").trim();
    if (!creator) {
      return res.status(400).json({ error: "Creator is required." });
    }
    if (!requireSessionUsernameMatch(res, session, creator)) return;

    const rawUser = findUserByUsername(String(creator).toLowerCase());
    const user = rawUser && typeof rawUser.then === "function" ? await rawUser : rawUser;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const rawChat = findChatById(chatId);
    const chat = rawChat && typeof rawChat.then === "function" ? await rawChat : rawChat;
    if (!chat) {
      return res.status(404).json({ error: "Chat not found." });
    }
    // Ticket domain only: a messenger (direct) chat has no lifecycle.
    if (String(chat.channel || "direct") !== "support" || !chat.department_id) {
      return res.status(400).json({
        error: "Only support conversations have a ticket lifecycle.",
        code: "not_a_ticket",
      });
    }

    const rawRole = getChatMemberRole(chatId, user.id);
    const role =
      rawRole && typeof rawRole.then === "function" ? await rawRole : rawRole;
    if (!role) {
      return res.status(403).json({ error: "Not a member of this chat." });
    }

    const ticket = await awaitMaybe(getTicketByChatId(chatId));
    const wasClosed = ticket ? ticket.status === "closed" : false;
    const target = nextStatus;
    if (ticket) {
      if (ticket.status === target) {
        // Idempotent no-op — still return the current state.
        return res.json({
          chatId,
          ticketId: ticket.id,
          status: target,
          changed: false,
        });
      }
      await awaitMaybe(setTicketStatusByChatId(chatId, target));
    }

    // Realtime fan-out so the peer's header badge flips immediately.
    await awaitMaybe(
      emitChatEvent(chatId, {
        type: "ticket_updated",
        chatId,
        chatChannel: "support",
        status: target,
        byUserId: user.id,
        username: user.username,
      })
    );
    await awaitMaybe(
      emitSseEvent(user.username, { type: "chat_list_changed", chatId })
    );

    return res.json({
      chatId,
      ticketId: ticket ? ticket.id : null,
      status: target,
      changed: ticket ? true : false,
      previousStatus: ticket ? (wasClosed ? "closed" : "open") : "open",
    });
  }

  app.post("/api/support/tickets/:chatId/close", (req, res) =>
    handleTicketStatusChange(req, res, "closed")
  );
  app.post("/api/support/tickets/:chatId/reopen", (req, res) =>
    handleTicketStatusChange(req, res, "open")
  );
}

export { registerDepartmentRoutes };
