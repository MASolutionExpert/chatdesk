/**
 * Stage 3 (MEDIUM) remediation tests — server/api/messages.js
 *
 * F3  shared closed-ticket guard (upload / edit / forward)
 * F4  forward: all targets validated before any write, MESSAGE_MAX_CHARS,
 *     dm.send, target-count cap
 * F5  reuseMessageFilesForForward keeps remote (s3/remote) attachment rows
 * F7  read-counts: ids scoped to the chat + array cap (200)
 */
import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

const ALICE_ID = "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4";
const ALICE = {
  id: ALICE_ID,
  username: "alice",
  nickname: "Alice",
  role: "user",
};

const GROUP_CHAT_ID = "c0c0c0c0-d1d1-4e2e-af3f-060606060606";
const DM_CHAT_ID = "c1c1c1c1-d2d2-4f3f-b040-171717171717";
const TICKET_CHAT_ID = "c2c2c2c2-d3d3-4f4f-b151-282828282828";
const MISSING_CHAT_ID = "c3c3c3c3-d4d4-4f5f-b262-393939393939";
const SOURCE_MSG_ID = "d0d0d0d0-e1e1-4f2f-b040-171717171717";
const NEW_MSG_ID = "d1d1d1d1-e2e2-4030-c151-282828282828";

function baseDeps(overrides = {}) {
  return {
    findUserByUsername: vi.fn().mockResolvedValue(ALICE),
    findUserById: vi.fn().mockResolvedValue(ALICE),
    isMember: vi.fn().mockResolvedValue(true),
    getChatMemberRole: vi.fn().mockResolvedValue("member"),
    findMessageById: vi.fn().mockResolvedValue(null),
    findChatById: vi.fn().mockResolvedValue(null),
    listMessageFilesByMessageIds: vi.fn().mockResolvedValue([]),
    getMessageAuthors: vi.fn().mockResolvedValue([]),
    getMessageReadCounts: vi.fn().mockResolvedValue([]),
    getTicketByChatId: vi.fn().mockResolvedValue(null),
    createMessage: vi.fn().mockResolvedValue(NEW_MSG_ID),
    createMessageFiles: vi.fn().mockResolvedValue([]),
    setMessageForwardOrigin: vi.fn().mockResolvedValue(undefined),
    emitChatEvent: vi.fn(),
    emitSseEvent: vi.fn(),
    ...overrides,
  };
}

function makeSessionApp(deps) {
  const { app, sessionStore, deps: wiredDeps, pendingUploadsStore } = makeApp({
    userStore: makeUserStore([ALICE]),
    deps,
  });
  sessionStore.createSession(ALICE_ID, "s3-session");
  return { app, wiredDeps, pendingUploadsStore };
}

// ─── F3: shared closed-ticket guard ──────────────────────────────────────────

describe("F3: closed support ticket blocks every message write path", () => {
  const ticketChat = { id: TICKET_CHAT_ID, type: "dm", channel: "support" };

  test("POST /api/messages still rejects closed tickets (regression)", async () => {
    const deps = baseDeps({
      findChatById: vi.fn().mockResolvedValue(ticketChat),
      getTicketByChatId: vi
        .fn()
        .mockResolvedValue({ id: "t1", status: "closed" }),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages")
      .set("Cookie", "sid=s3-session")
      .send({ chatId: TICKET_CHAT_ID, username: "alice", body: "hi" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket_closed");
  });

  test("upload (edit-with-files) into a closed ticket is rejected", async () => {
    const deps = baseDeps({
      findChatById: vi.fn().mockResolvedValue(ticketChat),
      getTicketByChatId: vi
        .fn()
        .mockResolvedValue({ id: "t1", status: "closed" }),
    });
    const { app, wiredDeps } = makeSessionApp(deps);
    // One server-issued presigned upload (the multipart path is stubbed out
    // by makeApp — presigned keys exercise the same guard).
    wiredDeps.recordPendingPresignedUpload({
      storageKey: "uploads/note.txt",
      userId: ALICE_ID,
      expiresAt: null,
    });
    const res = await request(app)
      .post("/api/messages/upload")
      .set("Cookie", "sid=s3-session")
      .send({
        chatId: TICKET_CHAT_ID,
        username: "alice",
        body: "attachment",
        storageKeys: ["uploads/note.txt"],
        fileMeta: JSON.stringify([
          { originalName: "note.txt", mimeType: "text/plain", sizeBytes: 12 },
        ]),
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket_closed");
    expect(deps.createMessage).not.toHaveBeenCalled();
    expect(deps.createMessageFiles).not.toHaveBeenCalled();
  });

  test("plain edit of a message in a closed ticket is rejected", async () => {
    const deps = baseDeps({
      findMessageById: vi
        .fn()
        .mockResolvedValue({
          id: SOURCE_MSG_ID,
          chat_id: TICKET_CHAT_ID,
          user_id: ALICE_ID,
          body: "old",
        }),
      findChatById: vi.fn().mockResolvedValue(ticketChat),
      getTicketByChatId: vi
        .fn()
        .mockResolvedValue({ id: "t1", status: "closed" }),
      // Role 'user' lacks ticket.message.edit by registry default — grant it
      // so the request reaches the ticket guard itself.
      hasPermission: vi.fn().mockResolvedValue(true),
      editMessage: vi.fn(),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/edit")
      .set("Cookie", "sid=s3-session")
      .send({
        chatId: TICKET_CHAT_ID,
        username: "alice",
        messageId: SOURCE_MSG_ID,
        body: "edited",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket_closed");
    expect(deps.editMessage).not.toHaveBeenCalled();
  });

  test("forward into a closed ticket is rejected", async () => {
    const deps = baseDeps({
      findMessageById: vi
        .fn()
        .mockResolvedValue({
          id: SOURCE_MSG_ID,
          chat_id: GROUP_CHAT_ID,
          user_id: ALICE_ID,
          body: "hello",
        }),
      findChatById: vi.fn().mockImplementation(async (id) => {
        if (id === GROUP_CHAT_ID) return { id, type: "group", channel: "direct" };
        if (id === TICKET_CHAT_ID) return ticketChat;
        return null;
      }),
      getTicketByChatId: vi
        .fn()
        .mockResolvedValue({ id: "t1", status: "closed" }),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [TICKET_CHAT_ID],
        body: "hello",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket_closed");
    expect(deps.createMessage).not.toHaveBeenCalled();
  });

  test("open support tickets and messenger chats are unaffected", async () => {
    const deps = baseDeps({
      findMessageById: vi
        .fn()
        .mockResolvedValue({
          id: SOURCE_MSG_ID,
          chat_id: GROUP_CHAT_ID,
          user_id: ALICE_ID,
          body: "hello",
        }),
      findChatById: vi.fn().mockResolvedValue({
        id: TICKET_CHAT_ID,
        type: "dm",
        channel: "support",
      }),
      getTicketByChatId: vi.fn().mockResolvedValue({ id: "t1", status: "open" }),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [TICKET_CHAT_ID],
        body: "hello",
      });
    expect(res.status).toBe(200);
    expect(res.body.ids).toEqual([NEW_MSG_ID]);
  });
});

// ─── F4: forward validation ──────────────────────────────────────────────────

describe("F4: /api/messages/forward validates all targets before writing", () => {
  const sourceMessage = {
    id: SOURCE_MSG_ID,
    chat_id: GROUP_CHAT_ID,
    user_id: ALICE_ID,
    body: "hello",
  };
  const sourceChat = { id: GROUP_CHAT_ID, type: "group", channel: "direct" };

  function forwardDeps(extra = {}) {
    return baseDeps({
      findMessageById: vi.fn().mockResolvedValue(sourceMessage),
      findChatById: vi.fn().mockResolvedValue(sourceChat),
      ...extra,
    });
  }

  test("an invalid target fails the WHOLE request before any write", async () => {
    const deps = forwardDeps({
      findChatById: vi.fn().mockImplementation(async (id) => {
        if (id === GROUP_CHAT_ID) return sourceChat;
        if (id === MISSING_CHAT_ID) return null; // second target missing
        return { id, type: "group", channel: "direct" };
      }),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [GROUP_CHAT_ID, MISSING_CHAT_ID],
        body: "hello",
      });
    expect(res.status).toBe(404);
    expect(deps.createMessage).not.toHaveBeenCalled();
    expect(deps.setMessageForwardOrigin).not.toHaveBeenCalled();
  });

  test("a dm.send-denied target fails the whole request before any write", async () => {
    const deps = forwardDeps({
      findChatById: vi.fn().mockImplementation(async (id) => {
        if (id === GROUP_CHAT_ID) return sourceChat;
        // Second target is a messenger DM the role cannot write to.
        return { id: DM_CHAT_ID, type: "dm", channel: "direct" };
      }),
      hasPermission: vi
        .fn()
        .mockImplementation(async (_role, key) => key !== "dm.send"),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [GROUP_CHAT_ID, DM_CHAT_ID],
        body: "hello",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("permission_denied");
    expect(deps.createMessage).not.toHaveBeenCalled();
  });

  test("forwarded body is limited by MESSAGE_MAX_CHARS", async () => {
    const deps = forwardDeps();
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [GROUP_CHAT_ID],
        body: "x".repeat(4001),
      });
    expect(res.status).toBe(400);
    expect(deps.createMessage).not.toHaveBeenCalled();
  });

  test("more than 50 targets is rejected outright", async () => {
    const deps = forwardDeps();
    const { app } = makeSessionApp(deps);
    const fiftyOne = Array.from({ length: 51 }, (_, i) => {
      const hex = (i + 1).toString(16).padStart(2, "0");
      return `e${hex}${hex}${hex}-aaaa-4bbb-bccc-dddddddddddd`;
    });
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: fiftyOne,
        body: "hello",
      });
    expect(res.status).toBe(400);
    expect(deps.createMessage).not.toHaveBeenCalled();
  });

  test("all-valid multi-target forwards still succeed", async () => {
    const targetA = "e1e1e1e1-aaaa-4bbb-bccc-dddddddddddd";
    const targetB = "e2e2e2e2-aaaa-4bbb-bccc-dddddddddddd";
    const deps = forwardDeps({
      findChatById: vi.fn().mockImplementation(async (id) => {
        if (id === GROUP_CHAT_ID) return sourceChat;
        return { id, type: "group", channel: "direct" };
      }),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [targetA, targetB],
        body: "hello",
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ids).toHaveLength(2);
    expect(deps.createMessage).toHaveBeenCalledTimes(2);
  });
});

// ─── F5: forwarding remote-storage attachments ───────────────────────────────

describe("F5: reuseMessageFilesForForward preserves storage metadata", () => {
  test("remote (s3) rows are copied with driver/key/encryption/thumb fields", async () => {
    const remoteRow = {
      id: "f1",
      kind: "media",
      message_id: SOURCE_MSG_ID,
      original_name: "clip.mp4",
      stored_name: "clip-abc.mp4",
      mime_type: "video/mp4",
      size_bytes: 1234,
      storage_driver: "s3",
      storage_key: "uploads/messages/clip-abc.mp4",
      thumb_storage_key: "uploads/messages/thumbs/clip-abc.jpg",
      encryption_type: "none",
    };
    const localRow = {
      id: "f2",
      kind: "document",
      message_id: SOURCE_MSG_ID,
      original_name: "notes.txt",
      stored_name: "notes-def.txt",
      mime_type: "text/plain",
      size_bytes: 10,
      storage_driver: "local",
    };
    const deps = baseDeps({
      findMessageById: vi.fn().mockResolvedValue({
        id: SOURCE_MSG_ID,
        chat_id: GROUP_CHAT_ID,
        user_id: ALICE_ID,
        body: "hello",
      }),
      findChatById: vi.fn().mockResolvedValue({
        id: GROUP_CHAT_ID,
        type: "group",
        channel: "direct",
      }),
      listMessageFilesByMessageIds: vi.fn().mockResolvedValue([remoteRow, localRow]),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [GROUP_CHAT_ID],
        body: "hello",
      });
    expect(res.status).toBe(200);
    // The local row's file does not exist on disk (makeApp fs stub) — it is
    // skipped gracefully. The s3 row has no local bytes by design and MUST
    // be copied with its storage metadata.
    expect(deps.createMessageFiles).toHaveBeenCalledTimes(1);
    const [messageId, files] = deps.createMessageFiles.mock.calls[0];
    expect(messageId).toBe(NEW_MSG_ID);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      storedName: "clip-abc.mp4",
      storageDriver: "s3",
      storageKey: "uploads/messages/clip-abc.mp4",
      thumbStorageKey: "uploads/messages/thumbs/clip-abc.jpg",
      encryptionType: "none",
    });
  });

  test("a missing local file still forwards without crashing", async () => {
    const deps = baseDeps({
      findMessageById: vi.fn().mockResolvedValue({
        id: SOURCE_MSG_ID,
        chat_id: GROUP_CHAT_ID,
        user_id: ALICE_ID,
        body: "hello",
      }),
      findChatById: vi.fn().mockResolvedValue({
        id: GROUP_CHAT_ID,
        type: "group",
        channel: "direct",
      }),
      listMessageFilesByMessageIds: vi.fn().mockResolvedValue([
        {
          id: "f3",
          kind: "document",
          message_id: SOURCE_MSG_ID,
          original_name: "gone.txt",
          stored_name: "gone.txt",
          mime_type: "text/plain",
          size_bytes: 4,
          storage_driver: "local",
        },
      ]),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/forward")
      .set("Cookie", "sid=s3-session")
      .send({
        username: "alice",
        sourceMessageId: SOURCE_MSG_ID,
        targetChatIds: [GROUP_CHAT_ID],
        body: "hello",
      });
    expect(res.status).toBe(200);
    // The local row's file does not exist on disk (makeApp fs stub) — it is
    // skipped gracefully and no file rows are created for the copy.
    expect(deps.createMessageFiles).not.toHaveBeenCalled();
  });
});

// ─── F7: read-counts scoping + cap ───────────────────────────────────────────

describe("F7: /api/messages/read-counts scopes ids to the chat and caps the array", () => {
  const IN_CHAT = "d2d2d2d2-e3e3-4f3f-c162-494949494949";
  const IN_OTHER_CHAT = "d3d3d3d3-e4e4-4f4f-c273-5a5a5a5a5a5a";

  test("ids from other chats never leak their counts", async () => {
    const deps = baseDeps({
      findChatById: vi.fn().mockResolvedValue({ id: GROUP_CHAT_ID, type: "group" }),
      findMessageById: vi.fn().mockImplementation(async (id) =>
        id === IN_CHAT
          ? { id, chat_id: GROUP_CHAT_ID }
          : { id, chat_id: "99999999-9999-4999-8999-999999999999" },
      ),
      getMessageAuthors: vi
        .fn()
        .mockResolvedValue([{ id: IN_CHAT, user_id: ALICE_ID }]),
      getMessageReadCounts: vi
        .fn()
        .mockImplementation(async (ids) =>
          [
            { message_id: IN_CHAT, count: 5 },
            { message_id: IN_OTHER_CHAT, count: 99 },
          ].filter((row) => ids.includes(row.message_id)),
        ),
    });
    const { app } = makeSessionApp(deps);
    const res = await request(app)
      .post("/api/messages/read-counts")
      .set("Cookie", "sid=s3-session")
      .send({
        chatId: GROUP_CHAT_ID,
        username: "alice",
        messageIds: [IN_CHAT, IN_OTHER_CHAT],
      });
    expect(res.status).toBe(200);
    expect(res.body.counts[IN_CHAT]).toBe(6); // 5 reads + author
    expect(res.body.counts[IN_OTHER_CHAT]).toBeUndefined();
    // Only the in-chat id reaches the count query.
    expect(deps.getMessageReadCounts).toHaveBeenCalledWith([IN_CHAT]);
  });

  test("the id array is capped at 200 (SQLite variable limit)", async () => {
    const deps = baseDeps({
      findChatById: vi.fn().mockResolvedValue({ id: GROUP_CHAT_ID, type: "group" }),
      findMessageById: vi
        .fn()
        .mockImplementation(async (id) => ({ id, chat_id: GROUP_CHAT_ID })),
      getMessageAuthors: vi.fn().mockResolvedValue([]),
      getMessageReadCounts: vi.fn().mockResolvedValue([]),
    });
    const { app } = makeSessionApp(deps);
    const many = Array.from({ length: 300 }, (_, i) => {
      const n = (i + 1).toString(16).padStart(12, "0");
      return `aaaaaaaa-0000-4000-8000-${n}`;
    });
    const res = await request(app)
      .post("/api/messages/read-counts")
      .set("Cookie", "sid=s3-session")
      .send({ chatId: GROUP_CHAT_ID, username: "alice", messageIds: many });
    expect(res.status).toBe(200);
    const passed = deps.getMessageReadCounts.mock.calls[0][0];
    expect(passed.length).toBe(200);
  });
});
