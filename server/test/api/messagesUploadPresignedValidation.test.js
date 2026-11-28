import { describe, test, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { makeApp } from "../helpers/makeApp.js";
import { RemoteStorageProvider } from "../../lib/storage/RemoteStorageProvider.js";

describe("POST /api/messages/upload presigned-key validation (security)", () => {
  let appObj;
  let mockRemoteProvider;
  let sessionToken;
  let userId;
  let otherUserId;
  const chatId = "c0c0c0c0-d1d1-4e2e-af3f-060606060606";

  beforeEach(() => {
    sessionToken = "test-session-token-presign-validation";
    mockRemoteProvider = new RemoteStorageProvider({
      STORAGE_BUCKET: "test-bucket",
      STORAGE_REGION: "us-east-1",
      STORAGE_ACCESS_KEY_ID: "test-key",
      STORAGE_SECRET_ACCESS_KEY: "test-secret",
    });
    vi.spyOn(mockRemoteProvider, "getDownloadUrl").mockImplementation(
      async (key) => `https://test-bucket.s3.amazonaws.com/${key}`,
    );

    appObj = makeApp({
      deps: {
        isMember: () => true,
        findChatById: () => ({ id: chatId, name: "test-chat", type: "group" }),
        emitChatEvent: () => {},
        storageProvider: mockRemoteProvider,
      },
    });

    userId = appObj.userStore.createUser("owner1", "hash", "Owner", null, "#10b981");
    otherUserId = appObj.userStore.createUser("owner2", "hash", "Other", null, "#0ea5e9");
    appObj.sessionStore.createSession(userId, sessionToken);
  });

  const recordPending = (app, key, ownerId) =>
    app.deps.recordPendingPresignedUpload({ storageKey: key, userId: ownerId });

  test("rejects a storage key that was never issued by the server", async () => {
    const res = await request(appObj.app)
      .post("/api/messages/upload")
      .set("Cookie", [`sid=${sessionToken}`])
      .send({
        chatId,
        username: "owner1",
        body: "never presigned",
        storageKeys: ["uploads/not-presigned.png"],
        fileMeta: JSON.stringify([
          { originalName: "not-presigned.png", mimeType: "image/png", sizeBytes: 10 },
        ]),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not issued by the server");
  });

  test("rejects a storage key issued to a DIFFERENT user", async () => {
    recordPending(appObj, "uploads/someone-elses.png", otherUserId);
    const res = await request(appObj.app)
      .post("/api/messages/upload")
      .set("Cookie", [`sid=${sessionToken}`])
      .send({
        chatId,
        username: "owner1",
        body: "stolen key",
        storageKeys: ["uploads/someone-elses.png"],
        fileMeta: JSON.stringify([
          { originalName: "someone-elses.png", mimeType: "image/png", sizeBytes: 10 },
        ]),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("not issued by the server");
  });

  test("accepts a key issued to the session user and drops the client thumb key", async () => {
    const emittedEvents = [];
    const emitApp = makeApp({
      deps: {
        isMember: () => true,
        findChatById: () => ({ id: chatId, name: "test-chat", type: "group" }),
        emitChatEvent: (_chatId, payload) => emittedEvents.push(payload),
        storageProvider: mockRemoteProvider,
      },
    });
    const emitUserId = emitApp.userStore.createUser("emituser", "hash", "E", null, "#222");
    emitApp.sessionStore.createSession(emitUserId, sessionToken);
    emitApp.deps.recordPendingPresignedUpload({
      storageKey: "uploads/mine.png",
      userId: emitUserId,
    });

    const res = await request(emitApp.app)
      .post("/api/messages/upload")
      .set("Cookie", [`sid=${sessionToken}`])
      .send({
        chatId,
        username: "emituser",
        body: "my own key",
        storageKeys: [
          {
            storageKey: "uploads/mine.png",
            thumbStorageKey: "../../../../etc/passwd",
            processingStatus: "ready",
            storageDriver: "attacker-driver",
            encryptionType: "aes-256-gcm",
          },
        ],
        fileMeta: JSON.stringify([
          { originalName: "mine.png", mimeType: "image/png", sizeBytes: 4096 },
        ]),
      });

    expect(res.status).toBe(200);
    // Pending record is consumed on success.
    const pendingLeft = emitApp.pendingUploadsStore.find(
      (r) => r.storage_key === "uploads/mine.png",
    );
    expect(pendingLeft).toBeUndefined();
    // The broadcast must carry server-derived fields only — the traversal
    // thumb key, the fake driver and the fake encryption type must never
    // reach the database or the receiving clients.
    expect(emittedEvents.length).toBeGreaterThan(0);
    const file = emittedEvents[0].files?.[0];
    expect(file).toBeTruthy();
    expect(file.thumbStorageKey ?? null).toBeNull();
    expect(file.thumbUrl ?? null).toBeNull();
    expect(String(file.url || "")).toContain("uploads/mine.png");
    expect(file.processing).toBe(false);
  });

  test("HEAD-verified size replaces a client-claimed size for quota checks", async () => {
    recordPending(appObj, "uploads/liar.zip", userId);
    const statProvider = {
      type: "s3",
      stat: vi.fn(async () => ({ sizeBytes: 20 * 1024 * 1024 })),
      getDownloadUrl: async (key) => `https://test-bucket.s3.amazonaws.com/${key}`,
    };
    const statApp = makeApp({
      deps: {
        isMember: () => true,
        findChatById: () => ({ id: chatId, name: "test-chat", type: "group" }),
        emitChatEvent: () => {},
        storageProvider: statProvider,
        MESSAGE_FILE_LIMITS: {
          maxFiles: 3,
          maxFileSizeBytes: 50 * 1024 * 1024,
          maxTotalBytes: 10 * 1024 * 1024,
        },
      },
    });
    const statUserId = statApp.userStore.createUser("statuser", "hash", "S", null, "#111");
    statApp.sessionStore.createSession(statUserId, sessionToken);
    statApp.deps.recordPendingPresignedUpload({
      storageKey: "uploads/liar.zip",
      userId: statUserId,
    });

    const res = await request(statApp.app)
      .post("/api/messages/upload")
      .set("Cookie", [`sid=${sessionToken}`])
      .send({
        chatId,
        username: "statuser",
        body: "lying about size",
        storageKeys: [
          { storageKey: "uploads/liar.zip", sizeBytes: 1 },
        ],
        fileMeta: JSON.stringify([
          { originalName: "liar.zip", mimeType: "application/zip", sizeBytes: 1 },
        ]),
      });

    expect(statProvider.stat).toHaveBeenCalledWith("uploads/liar.zip");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Total upload size cannot exceed");
  });
});
