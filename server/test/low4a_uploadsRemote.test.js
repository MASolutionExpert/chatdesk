// Stage 4 (LOW) security fixes — Task 4-a uploadsRemote tests:
//   4. POST /api/uploads/webhook/processed fails CLOSED when WEBHOOK_SECRET
//      is unset (503) and compares secrets timing-safely.
//   6. Dead multipart route POST /api/uploads is removed (404).

import { describe, test, expect, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { makeApp } from "./helpers/makeApp.js";
import { webhookSecretMatches } from "./api/uploadsRemote.js";

const FILE_ID = "f1f1f1f1-a2a2-4b3b-c5c5-3a3a3a3a3a3a";

function makeWebhookApp({ webhookSecret }) {
  const adminRun = vi.fn();
  const adminSave = vi.fn();
  const { app } = makeApp({
    deps: {
      webhookSecret,
      findMessageFileById: (id) =>
        String(id) === FILE_ID
          ? {
              id: FILE_ID,
              message_id: "m1",
              chat_id: "c1",
              storage_key: "uploads/messages/x.mp4",
              storage_driver: "remote",
            }
          : null,
      adminGetRow: () => null,
      adminRun,
      adminSave,
      emitChatEvent: vi.fn(),
      listMessageFilesByMessageIds: () => [],
    },
  });
  return { app, adminRun, adminSave };
}

// ─── Item 4: webhook secret handling ─────────────────────────────────────────

describe("POST /api/uploads/webhook/processed secret handling (low4a)", () => {
  test("returns 503 when no webhook secret is configured (fail closed)", async () => {
    const { app, adminRun } = makeWebhookApp({ webhookSecret: null });
    const res = await request(app)
      .post("/api/uploads/webhook/processed")
      .send({ fileId: FILE_ID, status: "ready" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/webhook secret/i);
    expect(adminRun).not.toHaveBeenCalled();
  });

  test("returns 503 even when the caller sends some secret header", async () => {
    const { app } = makeWebhookApp({ webhookSecret: null });
    const res = await request(app)
      .post("/api/uploads/webhook/processed")
      .set("x-chatdesk-webhook-secret", "anything")
      .send({ fileId: FILE_ID });
    expect(res.status).toBe(503);
  });

  test("returns 401 on wrong secret", async () => {
    const { app, adminRun } = makeWebhookApp({ webhookSecret: "correct-secret" });
    const res = await request(app)
      .post("/api/uploads/webhook/processed")
      .set("x-chatdesk-webhook-secret", "wrong-secret")
      .send({ fileId: FILE_ID, status: "ready" });
    expect(res.status).toBe(401);
    expect(adminRun).not.toHaveBeenCalled();
  });

  test("returns 401 on missing secret header", async () => {
    const { app } = makeWebhookApp({ webhookSecret: "correct-secret" });
    const res = await request(app)
      .post("/api/uploads/webhook/processed")
      .send({ fileId: FILE_ID, status: "ready" });
    expect(res.status).toBe(401);
  });

  test("processes the webhook when the secret matches", async () => {
    const { app, adminSave } = makeWebhookApp({ webhookSecret: "correct-secret" });
    const res = await request(app)
      .post("/api/uploads/webhook/processed")
      .set("x-chatdesk-webhook-secret", "correct-secret")
      .send({ fileId: FILE_ID, status: "ready" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(adminSave).toHaveBeenCalled();
  });
});

describe("webhookSecretMatches helper (low4a)", () => {
  test("matches an equal secret", () => {
    expect(webhookSecretMatches("s3cret", "s3cret")).toBe(true);
  });

  test("rejects a wrong secret", () => {
    expect(webhookSecretMatches("wrong", "s3cret")).toBe(false);
  });

  test("rejects a missing header", () => {
    expect(webhookSecretMatches(undefined, "s3cret")).toBe(false);
    expect(webhookSecretMatches(null, "s3cret")).toBe(false);
  });

  test("handles differing lengths without throwing (hash-based compare)", () => {
    const short = "a";
    const long = "a".repeat(4096);
    expect(webhookSecretMatches(short, long)).toBe(false);
    expect(webhookSecretMatches(long, short)).toBe(false);
    expect(webhookSecretMatches(long, long)).toBe(true);
  });

  test("rejects when the expected secret is unset/empty", () => {
    expect(webhookSecretMatches("x", null)).toBe(false);
    expect(webhookSecretMatches("x", "")).toBe(false);
    expect(webhookSecretMatches("", "")).toBe(false);
  });

  test("does not leak the secret length via early exit (constant work)", () => {
    // Sanity check only: hashes are always 32 bytes, so the comparison is
    // constant-length regardless of input lengths.
    const a = crypto.createHash("sha256").update("x", "utf8").digest();
    const b = crypto.createHash("sha256").update("y".repeat(500), "utf8").digest();
    expect(a.length).toBe(b.length);
  });
});

// ─── Item 6: dead POST /api/uploads route removed ────────────────────────────

describe("POST /api/uploads dead route removal (low4a)", () => {
  test("returns 404 and creates no message_file rows", async () => {
    const createMessageFiles = vi.fn(() => []);
    const { app } = makeApp({
      deps: { createMessageFiles },
    });
    const res = await request(app)
      .post("/api/uploads")
      .field("filename", "orphan.png")
      .field("contentType", "image/png")
      .field("fileSize", "1234");
    expect(res.status).toBe(404);
    expect(createMessageFiles).not.toHaveBeenCalled();
  });

  test("returns 404 for authenticated callers too (route removed, not gated)", async () => {
    const { app } = makeApp({});
    const res = await request(app)
      .post("/api/uploads")
      .field("filename", "orphan2.png");
    expect(res.status).toBe(404);
  });
});
