/**
 * Stage 2 HIGH fixes for server/api/uploadsRemote.js:
 *
 *   [F2] GET /api/uploads/file/:id had NO session and NO membership check —
 *        file ids were enumerable, so anyone could obtain 302s to presigned
 *        URLs (or decrypted bytes) for every remote file. The route now
 *        mirrors the Stage 1 pattern of GET /api/uploads/thumbs/:fileId:
 *        session → file → parent message → chat → membership (owner/staff
 *        exempt).
 *
 *   [F3] POST /api/uploads/presign with a messageId called
 *        createMessageFiles(messageId, …) without any ownership check — any
 *        user could inject attachments into anyone's message. Now the message
 *        must exist and belong to the session user (fail closed).
 *
 *   [F5] The decrypted-bytes serving paths of file/:id echoed the
 *        client-controlled mime_type as Content-Type inline — fixed via the
 *        shared safe serving policy (server/lib/uploadContentTypes.js).
 */
import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import { makeApp } from "../helpers/makeApp.js";

const STORAGE_PROVIDER = {
  type: "s3",
  getUploadUrl: async ({ key }) => ({
    type: "s3",
    uploadUrl: `https://test-bucket.s3.amazonaws.com/${key}?presigned=true`,
    storageKey: key,
  }),
  getDownloadUrl: vi.fn(async (key) => `https://test-bucket.s3.amazonaws.com/${key}?download=true`),
};

function makeFileApp(fileRecord, { members = [], role = "user" } = {}) {
  const appObj = makeApp({
    deps: {
      storageProvider: STORAGE_PROVIDER,
      storageEncryption: { decryptBuffer: (b) => b, decryptText: (t) => t },
      findMessageFileById: (id) =>
        String(id) === String(fileRecord.id) ? fileRecord : null,
      findMessageById: (id) =>
        String(id) === String(fileRecord.message_id ?? "")
          ? { id: String(fileRecord.message_id), chat_id: "chat-1", user_id: fileRecord.message_owner_id ?? null }
          : null,
      isMember: (chatId, uid) =>
        String(chatId) === "chat-1" && members.map(String).includes(String(uid)),
    },
  });
  const userId = appObj.userStore.createUser("gateuser", "hash", "Gate User", null, "#10b981", { role });
  appObj.sessionStore.createSession(userId, "gate-token");
  return { appObj, userId };
}

describe("GET /api/uploads/file/:id — session + membership gate (F2)", () => {
  const remoteFile = {
    id: 101,
    storage_driver: "s3",
    storage_key: "uploads/messages/101.png",
    encryption_type: "remote",
    message_id: "msg-1",
  };

  test("401s without a session", async () => {
    const { appObj } = makeFileApp(remoteFile);
    const res = await request(appObj.app).get("/api/uploads/file/101");
    expect(res.status).toBe(401);
  });

  test("403s for an authenticated non-member and never leaks the presigned URL", async () => {
    const { appObj, userId } = makeFileApp(remoteFile, { members: ["nobody-else"] });
    STORAGE_PROVIDER.getDownloadUrl.mockClear();
    const res = await request(appObj.app)
      .get("/api/uploads/file/101")
      .set("Cookie", "sid=gate-token");
    expect(res.status).toBe(403);
    expect(STORAGE_PROVIDER.getDownloadUrl).not.toHaveBeenCalled();
    expect(res.text || "").not.toContain("presigned");
    void userId;
  });

  test("302s a chat member to the presigned download URL", async () => {
    const members = [];
    const { appObj, userId } = makeFileApp(remoteFile, { members });
    members.push(userId);
    const res = await request(appObj.app)
      .get("/api/uploads/file/101")
      .set("Cookie", "sid=gate-token");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("download=true");
  });

  test("staff roles are exempt from membership", async () => {
    const { appObj } = makeFileApp(remoteFile, { members: [], role: "admin" });
    const res = await request(appObj.app)
      .get("/api/uploads/file/101")
      .set("Cookie", "sid=gate-token");
    expect(res.status).toBe(302);
  });

  test("404s when the file has no parent message", async () => {
    const members = [];
    const { appObj, userId } = makeFileApp(
      { ...remoteFile, id: 102, message_id: null },
      { members },
    );
    members.push(userId);
    const res = await request(appObj.app)
      .get("/api/uploads/file/102")
      .set("Cookie", "sid=gate-token");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/uploads/file/:id — safe serving policy (F5)", () => {
  test("decrypted remote bytes: derives Content-Type from the extension and forces attachment for a poisoned *+xml mime", async () => {
    const fileRecord = {
      id: 103,
      storage_driver: "s3",
      storage_key: "uploads/messages/103.png",
      stored_name: "103.png",
      mime_type: "application/x-a+xml",
      encryption_type: "local",
      message_id: "msg-1",
    };
    const members = [];
    const { appObj, userId } = makeFileApp(fileRecord, { members });
    members.push(userId);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    try {
      const res = await request(appObj.app)
        .get("/api/uploads/file/103")
        .set("Cookie", "sid=gate-token");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("image/png");
      expect(res.headers["content-type"]).not.toContain("xml");
      expect(res.headers["content-disposition"]).toContain("attachment");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    } finally {
      global.fetch = undefined;
    }
  });

  test("decrypted remote bytes: legit mp4 stays inline", async () => {
    const fileRecord = {
      id: 104,
      storage_driver: "s3",
      storage_key: "uploads/messages/104.mp4",
      stored_name: "104.mp4",
      mime_type: "video/mp4",
      encryption_type: "local",
      message_id: "msg-1",
    };
    const members = [];
    const { appObj, userId } = makeFileApp(fileRecord, { members });
    members.push(userId);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    try {
      const res = await request(appObj.app)
        .get("/api/uploads/file/104")
        .set("Cookie", "sid=gate-token");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("video/mp4");
      expect(res.headers["content-disposition"]).toBeUndefined();
    } finally {
      global.fetch = undefined;
    }
  });

  test("local driver: safe inline headers, attachment for non-inline types", async () => {
    const members = [];
    const { appObj, userId } = makeFileApp(
      {
        id: 105,
        storage_driver: "local",
        stored_name: "105.png",
        mime_type: "application/x-a+xml",
        message_id: "msg-1",
      },
      { members },
    );
    members.push(userId);
    const res = await request(appObj.app)
      .get("/api/uploads/file/105")
      .set("Cookie", "sid=gate-token");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });
});

describe("POST /api/uploads/presign — messageId ownership (F3)", () => {
  function makePresignApp({ createMessageFiles } = {}) {
    // findMessageById resolves AFTER the user is created, so the ownership
    // message rows can reference the in-test session user id.
    let ownerUserId = null;
    const appObj = makeApp({
      deps: {
        storageProvider: STORAGE_PROVIDER,
        createMessageFiles: createMessageFiles || (() => []),
        findMessageById: (id) => {
          if (id === "msg-own" && ownerUserId != null) {
            return { id: "msg-own", user_id: ownerUserId, chat_id: "chat-own" };
          }
          if (id === "msg-foreign") {
            return { id: "msg-foreign", user_id: "someone-else", chat_id: "chat-x" };
          }
          return null;
        },
      },
    });
    const userId = appObj.userStore.createUser("presign-owner", "hash", "P", null, "#10b981");
    appObj.sessionStore.createSession(userId, "presign-token");
    ownerUserId = userId;
    return { appObj, userId };
  }

  const payload = {
    filename: "clip.png",
    contentType: "image/png",
    fileSize: 1024,
  };

  test("403s and does not attach when the message belongs to another user", async () => {
    const createMessageFiles = vi.fn(() => []);
    const { appObj } = makePresignApp({ createMessageFiles });
    const res = await request(appObj.app)
      .post("/api/uploads/presign")
      .set("Cookie", "sid=presign-token")
      .send({ ...payload, messageId: "msg-foreign" });
    expect(res.status).toBe(403);
    expect(createMessageFiles).not.toHaveBeenCalled();
  });

  test("403s (fail closed) for an unknown messageId", async () => {
    const { appObj } = makePresignApp({});
    const res = await request(appObj.app)
      .post("/api/uploads/presign")
      .set("Cookie", "sid=presign-token")
      .send({ ...payload, messageId: "msg-unknown" });
    expect(res.status).toBe(403);
  });

  test("allows presign-with-messageId for the session user's own message", async () => {
    const createMessageFiles = vi.fn((msgId, files) => [
      { id: "file-1", message_id: msgId, ...files[0] },
    ]);
    const { appObj } = makePresignApp({ createMessageFiles });
    const res = await request(appObj.app)
      .post("/api/uploads/presign")
      .set("Cookie", "sid=presign-token")
      .send({ ...payload, messageId: "msg-own" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(createMessageFiles).toHaveBeenCalledWith(
      "msg-own",
      expect.arrayContaining([expect.objectContaining({ originalName: "clip.png" })]),
    );
    expect(res.body.fileId).toBe("file-1");
  });

  test("presign without messageId keeps working (real client flow)", async () => {
    const createMessageFiles = vi.fn(() => []);
    const { appObj } = makePresignApp({ createMessageFiles });
    const res = await request(appObj.app)
      .post("/api/uploads/presign")
      .set("Cookie", "sid=presign-token")
      .send(payload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(createMessageFiles).not.toHaveBeenCalled();
  });
});
