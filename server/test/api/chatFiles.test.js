import { describe, test, expect } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { makeApp, makeUserStore } from "../helpers/makeApp.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chats/:chatId/files — per-thread files gallery (profile "Files").
//
// Guarantees under test:
//   * members get every file in the thread from BOTH sides, newest first,
//     each row carrying the sender identity and the original message
//     timestamp (sentAt)
//   * non-members are rejected with 403
//   * missing username → 400, unknown user → 404
//   * pagination fields (total / hasMore) are echoed correctly
//   * local-driver files resolve to /api/uploads/messages/<stored_name>;
//     remote-driver files go through storageProvider.getDownloadUrl
// ─────────────────────────────────────────────────────────────────────────────

async function loginCookie(app, username = "alice", password = "secret123") {
  const res = await request(app)
    .post("/api/login")
    .send({ username, password });
  return res.headers["set-cookie"];
}

describe("per-thread files gallery API", () => {
  const chatId = "33333333-3333-4333-8333-333333333333";
  const otherChatId = "44444444-4444-4444-8444-444444444444";

  function createTestApp({ files = [], total } = {}) {
    const userStore = makeUserStore([
      {
        id: "11111111-1111-4111-a111-111111111111",
        username: "alice",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Alice",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "user",
        banned: false,
      },
      {
        id: "22222222-2222-4222-b222-222222222222",
        username: "bob",
        password_hash: bcrypt.hashSync("secret123", 4),
        nickname: "Bob",
        avatar_url: null,
        color: "#10b981",
        status: "online",
        role: "user",
        banned: false,
      },
    ]);

    const rows = files.map((f, i) => ({
      id: f.id ?? i + 1,
      message_id: f.message_id ?? `m${i + 1}`,
      kind: f.kind ?? "document",
      original_name: f.name ?? "report.pdf",
      stored_name: f.stored_name ?? `stored-${i + 1}`,
      mime_type: f.mime_type ?? "application/pdf",
      size_bytes: f.size_bytes ?? 2048,
      width_px: f.width_px ?? null,
      height_px: f.height_px ?? null,
      duration_seconds: f.duration_seconds ?? null,
      expires_at: f.expires_at ?? null,
      created_at: f.created_at ?? "2026-01-01T00:00:00.000Z",
      storage_driver: f.storage_driver ?? "local",
      storage_key: f.storage_key ?? null,
      processing_status: f.processing_status ?? "ready",
      blurhash: f.blurhash ?? null,
      waveform: f.waveform ?? null,
      thumb_storage_key: f.thumb_storage_key ?? null,
      encryption_type: f.encryption_type ?? "none",
      username: f.username ?? "alice",
      nickname: f.nickname ?? "Alice",
      color: f.color ?? "#10b981",
      avatar_url: f.avatar_url ?? null,
      sender_user_id: f.sender_user_id ?? "11111111-1111-4111-a111-111111111111",
      message_created_at: f.message_created_at ?? "2026-01-01T12:30:00.000Z",
    }));

    const { app } = makeApp({
      userStore,
      storageProvider: {
        type: "remote",
        getDownloadUrl: async (key) => `presigned://${key}`,
      },
      deps: {
        isMember: (cId, _uId) => cId === chatId,
        listChatFilesForUser: (cId, _uId, options = {}) => {
          const offset = Number(options.offset || 0);
          const limit = Number(options.limit || 60);
          return rows.slice(offset, offset + limit);
        },
        countChatFilesForUser: () => Number(total ?? rows.length),
      },
    });

    return { app, rows };
  }

  test("returns both sides' files with sender identity and sentAt timestamp", async () => {
    const { app } = createTestApp({
      files: [
        { kind: "image", name: "photo.png", username: "bob", nickname: "Bob", message_created_at: "2026-02-05T18:45:00.000Z" },
        { kind: "document", name: "contract.pdf", username: "alice", nickname: "Alice", message_created_at: "2026-02-06T09:10:00.000Z" },
      ],
      total: 2,
    });
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${chatId}/files?username=alice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.files).toHaveLength(2);

    const [photo, contract] = res.body.files;
    expect(photo.kind).toBe("image");
    expect(photo.name).toBe("photo.png");
    expect(photo.sender.username).toBe("bob");
    expect(photo.sender.nickname).toBe("Bob");
    expect(photo.sentAt).toBe("2026-02-05T18:45:00.000Z");
    expect(photo.messageId).toBeTruthy();

    expect(contract.sender.username).toBe("alice");
    expect(contract.sentAt).toBe("2026-02-06T09:10:00.000Z");
    // local driver → local upload URL
    expect(contract.url).toMatch(/^\/api\/uploads\/messages\//);
  });

  test("paginates with offset and reports hasMore", async () => {
    const { app } = createTestApp({
      files: Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.bin` })),
      total: 5,
    });
    const cookie = await loginCookie(app);

    const page1 = await request(app)
      .get(`/api/chats/${chatId}/files?username=alice&limit=3&offset=0`)
      .set("Cookie", cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.files).toHaveLength(3);
    expect(page1.body.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`/api/chats/${chatId}/files?username=alice&limit=3&offset=3`)
      .set("Cookie", cookie);
    expect(page2.status).toBe(200);
    expect(page2.body.files).toHaveLength(2);
    expect(page2.body.hasMore).toBe(false);
  });

  test("remote-driver files are served via storageProvider presigned URLs", async () => {
    const { app } = createTestApp({
      files: [
        {
          kind: "video",
          name: "clip.mp4",
          storage_driver: "remote",
          storage_key: "videos/clip.mp4",
        },
      ],
    });
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${chatId}/files?username=alice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.files[0].url).toContain("presigned://videos/clip.mp4");
  });

  test("rejects non-members with 403", async () => {
    const { app } = createTestApp();
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${otherChatId}/files?username=alice`)
      .set("Cookie", cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not a member/i);
  });

  test("rejects missing username with 400", async () => {
    const { app } = createTestApp();
    const cookie = await loginCookie(app);

    const res = await request(app)
      .get(`/api/chats/${chatId}/files`)
      .set("Cookie", cookie);

    expect(res.status).toBe(400);
  });
});
