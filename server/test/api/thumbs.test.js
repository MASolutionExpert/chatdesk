import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import realFs from "node:fs";
import realPath from "node:path";
import os from "node:os";
import { makeApp } from "../helpers/makeApp.js";
import { createStorageEncryption } from "../../lib/storageEncryption.js";
import { resolveThumbUrl, isAppEncryptedType } from "../../lib/thumbUrl.js";

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const originalKey = process.env.STORAGE_ENCRYPTION_KEY;

describe("resolveThumbUrl", () => {
  test("routes app-encrypted remote thumbs through the server proxy", async () => {
    const getDownloadUrl = vi.fn(async (k) => `https://cdn.example.com/${k}`);
    for (const enc of ["local", "aes-256-gcm", "app"]) {
      const url = await resolveThumbUrl({
        storageProvider: { getDownloadUrl },
        file: { id: 7, storage_driver: "s3", encryption_type: enc },
        thumbKey: "thumbs/t.jpg",
      });
      expect(url).toBe("/api/uploads/thumbs/7");
    }
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  test("keeps presigned redirects for plaintext remote thumbs", async () => {
    const getDownloadUrl = vi.fn(async (k) => `https://cdn.example.com/${k}`);
    const url = await resolveThumbUrl({
      storageProvider: { getDownloadUrl },
      file: { id: 7, storage_driver: "s3", encryption_type: "remote" },
      thumbKey: "thumbs/t.jpg",
    });
    expect(url).toBe("https://cdn.example.com/thumbs/t.jpg");
  });

  test("returns null for local driver and missing keys", async () => {
    const getDownloadUrl = vi.fn();
    expect(
      await resolveThumbUrl({
        storageProvider: { getDownloadUrl },
        file: { id: 7, storage_driver: "local", encryption_type: "local" },
        thumbKey: "t-thumb.jpg",
      }),
    ).toBeNull();
    expect(
      await resolveThumbUrl({
        storageProvider: { getDownloadUrl },
        file: { id: 7, storage_driver: "s3" },
        thumbKey: null,
      }),
    ).toBeNull();
    expect(getDownloadUrl).not.toHaveBeenCalled();
  });

  test("isAppEncryptedType classifies flags", () => {
    expect(isAppEncryptedType("local")).toBe(true);
    expect(isAppEncryptedType("AES-256-GCM")).toBe(true);
    expect(isAppEncryptedType("remote")).toBe(false);
    expect(isAppEncryptedType("none")).toBe(false);
    expect(isAppEncryptedType(null)).toBe(false);
  });
});

describe("GET /api/uploads/thumbs/:fileId", () => {
  let tmpDir;
  let originalFetch;
  let sessionToken;
  let appUserId;

  beforeEach(() => {
    tmpDir = realFs.mkdtempSync(realPath.join(os.tmpdir(), "sb-thumb-test-"));
    originalFetch = global.fetch;
    sessionToken = "thumb-test-session-token";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.STORAGE_ENCRYPTION_KEY;
    else process.env.STORAGE_ENCRYPTION_KEY = originalKey;
    realFs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function appWithFile(fileRecord, { withKey = true } = {}) {
    if (withKey) process.env.STORAGE_ENCRYPTION_KEY = "thumb-route-key";
    else delete process.env.STORAGE_ENCRYPTION_KEY;
    const storageEncryption = createStorageEncryption({
      fsImpl: realFs,
      pathImpl: realPath,
    });
    const appObj = makeApp({
      deps: {
        fs: realFs,
        path: realPath,
        uploadRootDir: tmpDir,
        storageEncryption,
        findMessageFileById: (id) =>
          String(id) === String(fileRecord.id) ? fileRecord : null,
        findMessageById: (id) =>
          String(id) === String(fileRecord.message_id ?? fileRecord.messageId ?? "")
            ? { id: String(fileRecord.message_id ?? fileRecord.messageId), chat_id: "thumb-chat-1" }
            : null,
        isMember: (chatId, uid) =>
          String(chatId) === "thumb-chat-1" && String(uid) === String(appUserId),
      },
    });
    appUserId = appObj.userStore.createUser(
      "thumbuser",
      "hash",
      "Thumb User",
      null,
      "#10b981",
    );
    appObj.sessionStore.createSession(appUserId, sessionToken);
    return appObj;
  }

  const getThumb = (appObj, fileId, withCookie = true) =>
    request(appObj.app)
      .get(`/api/uploads/thumbs/${fileId}`)
      .set(withCookie ? "Cookie" : "x-no-cookie", withCookie ? `sid=${sessionToken}` : "");

  test("401s without a session", async () => {
    const appObj = appWithFile({
      id: 15,
      storage_driver: "local",
      encryption_type: "none",
      message_id: "thumb-message-1",
      thumb_storage_key: "clip-thumb.jpg",
    }, { withKey: false });
    const res = await request(appObj.app).get("/api/uploads/thumbs/15");
    expect(res.status).toBe(401);
  });

  test("403s for an authenticated non-member", async () => {
    realFs.writeFileSync(
      realPath.join(tmpDir, "clip-thumb.jpg"),
      Buffer.concat([JPEG_HEAD, Buffer.from("thumb")]),
    );
    const foreignAppObj = makeApp({
      deps: {
        fs: realFs,
        path: realPath,
        uploadRootDir: tmpDir,
        findMessageFileById: (id) =>
          String(id) === "16"
            ? { id: 16, storage_driver: "local", encryption_type: "none", message_id: "thumb-message-2", thumb_storage_key: "clip-thumb.jpg" }
            : null,
        findMessageById: (id) =>
          String(id) === "thumb-message-2" ? { id, chat_id: "foreign-chat" } : null,
        isMember: () => false,
      },
    });
    const foreignUserId = foreignAppObj.userStore.createUser("outsider", "hash", "Out", null, "#000");
    foreignAppObj.sessionStore.createSession(foreignUserId, "outsider-token");
    const foreignRes = await request(foreignAppObj.app)
      .get("/api/uploads/thumbs/16")
      .set("Cookie", "sid=outsider-token");
    expect(foreignRes.status).toBe(403);
  });

  test("rejects a traversal thumb key even for a member (404)", async () => {
    const secretPath = realPath.join(tmpDir, "..", "thumb-secret.env");
    realFs.writeFileSync(secretPath, "SUPER_SECRET=1");
    const plain = Buffer.concat([JPEG_HEAD, Buffer.from("thumb")]);
    realFs.writeFileSync(realPath.join(tmpDir, "clip-thumb.jpg"), plain);
    const appObj = appWithFile({
      id: 17,
      storage_driver: "local",
      encryption_type: "none",
      message_id: "thumb-message-1",
      thumb_storage_key: "../thumb-secret.env",
    }, { withKey: false });

    const res = await getThumb(appObj, 17);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("SUPER_SECRET");
    realFs.rmSync(secretPath, { force: true });
  });

  test("serves and decrypts an encrypted local thumbnail", async () => {
    process.env.STORAGE_ENCRYPTION_KEY = "thumb-route-key";
    const storageEncryption = createStorageEncryption({
      fsImpl: realFs,
      pathImpl: realPath,
    });
    const plain = Buffer.concat([JPEG_HEAD, Buffer.from("thumb-bytes")]);
    realFs.writeFileSync(
      realPath.join(tmpDir, "clip-thumb.jpg"),
      storageEncryption.encryptBuffer(plain),
    );
    const appObj = appWithFile({
      id: 11,
      storage_driver: "local",
      encryption_type: "local",
      message_id: "thumb-message-1",
      thumb_storage_key: "clip-thumb.jpg",
    });

    const res = await request(appObj.app).get("/api/uploads/thumbs/11").set("Cookie", `sid=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(res.body).equals(plain)).toBe(true);
  });

  test("serves a plaintext local thumbnail unchanged", async () => {
    const plain = Buffer.concat([JPEG_HEAD, Buffer.from("plain-thumb")]);
    realFs.writeFileSync(realPath.join(tmpDir, "clip-thumb.jpg"), plain);
    const appObj = appWithFile(
      {
        id: 12,
        storage_driver: "local",
        encryption_type: "none",
        message_id: "thumb-message-1",
        thumb_storage_key: "clip-thumb.jpg",
      },
      { withKey: false },
    );

    const res = await request(appObj.app).get("/api/uploads/thumbs/12").set("Cookie", `sid=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).equals(plain)).toBe(true);
  });

  test("fetches and decrypts an encrypted remote thumbnail", async () => {
    process.env.STORAGE_ENCRYPTION_KEY = "thumb-route-key";
    const storageEncryption = createStorageEncryption({
      fsImpl: realFs,
      pathImpl: realPath,
    });
    const plain = Buffer.concat([JPEG_HEAD, Buffer.from("remote-thumb")]);
    const cipher = storageEncryption.encryptBuffer(plain);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => cipher,
    });
    const appObj = appWithFile({
      id: 13,
      storage_driver: "s3",
      encryption_type: "local",
      message_id: "thumb-message-1",
      thumb_storage_key: "thumbs/clip-thumb.jpg",
    });
    appObj.deps.storageProvider = {
      getDownloadUrl: vi.fn(async () => "https://cdn.example.com/thumbs/x"),
    };

    const res = await request(appObj.app).get("/api/uploads/thumbs/13").set("Cookie", `sid=${sessionToken}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(res.body).equals(plain)).toBe(true);
  });

  test("404s for unknown files and files without thumbnails", async () => {
    const appObj = appWithFile(
      { id: 14, storage_driver: "local", message_id: "thumb-message-1", thumb_storage_key: null },
      { withKey: false },
    );
    expect(
      (await request(appObj.app).get("/api/uploads/thumbs/999").set("Cookie", `sid=${sessionToken}`)).status,
    ).toBe(404);
    expect(
      (await request(appObj.app).get("/api/uploads/thumbs/14").set("Cookie", `sid=${sessionToken}`)).status,
    ).toBe(404);
  });
});

describe("webhook thumbUrl wiring", () => {
  test("emits proxy thumbUrl for app-encrypted remote files", async () => {
    const fileUuid = "20000000-0000-4000-8000-000000000031";
    const messageUuid = "50000000-0000-4000-8000-000000000016";
    const chatUuid = "42000000-0000-4000-8000-000000000053";
    const fileRecord = {
      id: fileUuid,
      message_id: messageUuid,
      storage_driver: "s3",
      storage_key: "uploads/raw.mp4",
      encryption_type: "local",
      processing_status: "pending",
      mime_type: "video/mp4",
    };
    const emitChatEventMock = vi.fn();
    const customApp = makeApp({
      deps: {
        storageProvider: {
          getDownloadUrl: vi.fn(
            async (key) => `https://cdn.example.com/${key}`,
          ),
        },
        webhookSecret: "secret-key-123",
        findMessageFileById: (id) =>
          String(id) === fileUuid ? fileRecord : null,
        listMessageFilesByMessageIds: () => [fileRecord],
        adminGetRow: (sql) => {
          if (sql.includes("chat_messages"))
            return { chat_id: chatUuid, id: messageUuid };
          if (sql.includes("chat_message_files")) return fileRecord;
          return null;
        },
        adminRun: () => {},
        adminSave: () => {},
        emitChatEvent: emitChatEventMock,
      },
    });

    const res = await request(customApp.app)
      .post("/api/uploads/webhook/processed")
      .set("x-chatdesk-webhook-secret", "secret-key-123")
      .send({
        fileId: fileUuid,
        status: "ready",
        transcodedStorageKey: "transcoded/video31.mp4",
        thumbStorageKey: "thumbs/thumb31.jpg",
      });

    expect(res.status).toBe(200);
    expect(emitChatEventMock).toHaveBeenCalledWith(
      chatUuid,
      expect.objectContaining({
        type: "chat_message_updated",
        files: expect.arrayContaining([
          expect.objectContaining({
            id: fileUuid,
            thumbUrl: `/api/uploads/thumbs/${fileUuid}`,
          }),
        ]),
      }),
    );
  });
});
