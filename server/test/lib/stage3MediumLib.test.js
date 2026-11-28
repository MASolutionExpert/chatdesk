/**
 * Stage 3 (MEDIUM) remediation tests
 *
 * F1  callManager.relaySignal — the peer's payload must never override the
 *     event envelope (type/chatId) or smuggle arbitrary keys
 * F9  remoteMirror blob route — safe serving policy (Content-Type derived
 *     from the stored reference, attachment outside the safe-inline policy)
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCallManager } from "../../lib/callManager.js";
import { makeApp, makeSessionStore, makeUserStore } from "../helpers/makeApp.js";
import { createMirrorJobRegistry } from "../../lib/remoteMirrorJobs.js";

// ─── F1: relaySignal envelope + allowlist ────────────────────────────────────

const CHAT_ID = "c0c0c0c0-d1d1-4e2e-af3f-060606060606";
const CALLER = { id: "a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4", username: "alice", nickname: "Alice", role: "user" };
const CALLEE = { id: "a1a1a1a1-b2b2-4c3c-8d4e-e5e5e5e5e5e5", username: "bob", nickname: "Bob", role: "user" };

function makeCallManager() {
  const emitted = [];
  const emitToUser = vi.fn((username, payload) => {
    emitted.push({ username, payload });
  });
  const callManager = createCallManager({
    findChatById: async () => ({ id: CHAT_ID, type: "dm", channel: "direct" }),
    isMember: async () => true,
    listChatMembers: async () => [
      { id: CALLER.id, username: CALLER.username },
      { id: CALLEE.id, username: CALLEE.username },
    ],
    findUserById: async (id) => (id === CALLER.id ? CALLER : CALLEE),
    emitToUser,
    sweepIntervalMs: 0,
    ringTimeoutMs: 60000,
  });
  return { callManager, emitted, emitToUser };
}

async function startRingingCall(callManager) {
  const start = await callManager.startCall({
    user: CALLER,
    chatId: CHAT_ID,
    type: "voice",
  });
  expect(start.status).toBe(200);
  return start.call;
}

describe("F1: relaySignal envelope protection", () => {
  test("the payload cannot override type or chatId (wire format preserved)", async () => {
    const { callManager, emitted } = makeCallManager();
    await startRingingCall(callManager);

    const res = await callManager.relaySignal({
      user: CALLEE,
      chatId: CHAT_ID,
      signalType: "answer",
      // PoC from the review: forged event envelope + sender identity.
      payload: {
        type: "chat_message",
        chatId: "aaaaaaaa-0000-4000-8000-000000000000",
        username: "ceo",
        body: "you are fired",
        sdp: "v=0 answer",
      },
    });
    expect(res.status).toBe(200);

    const event = emitted.find((e) => e.payload.type === "call:answer");
    expect(event).toBeTruthy();
    expect(event.username).toBe("alice");
    expect(event.payload.chatId).toBe(CHAT_ID);
    expect(event.payload.username).toBeUndefined();
    expect(event.payload.body).toBeUndefined();
    expect(event.payload.sdp).toBe("v=0 answer");
  });

  test("only allowlisted signal keys are relayed", async () => {
    const { callManager, emitted } = makeCallManager();
    await startRingingCall(callManager);

    await callManager.relaySignal({
      user: CALLER,
      chatId: CHAT_ID,
      signalType: "ice-candidate",
      payload: {
        candidate: { candidate: "candidate:1 1 udp ..." },
        evilKey: "alert(1)",
        messageId: "x",
        userId: "y",
      },
    });

    const event = emitted.find((e) => e.payload.type === "call:ice-candidate");
    expect(event).toBeTruthy();
    expect(event.username).toBe("bob");
    expect(event.payload.chatId).toBe(CHAT_ID);
    expect(event.payload.candidate).toEqual({ candidate: "candidate:1 1 udp ..." });
    expect(event.payload.evilKey).toBeUndefined();
    expect(event.payload.messageId).toBeUndefined();
    expect(event.payload.userId).toBeUndefined();
  });

  test("legitimate camera/screen-share state still relays", async () => {
    const { callManager, emitted } = makeCallManager();
    await startRingingCall(callManager);
    await callManager.relaySignal({
      user: CALLER,
      chatId: CHAT_ID,
      signalType: "camera-state",
      payload: { cameraOff: true },
    });
    await callManager.relaySignal({
      user: CALLER,
      chatId: CHAT_ID,
      signalType: "screen-share-state",
      payload: { sharing: true },
    });

    const cameraEvent = emitted.find((e) => e.payload.type === "call:camera-state");
    const shareEvent = emitted.find((e) => e.payload.type === "call:screen-share-state");
    expect(cameraEvent.payload.cameraOff).toBe(true);
    expect(shareEvent.payload.sharing).toBe(true);
  });
});

// ─── F9: remote-mirror blob serving policy ───────────────────────────────────

describe("F9: remote mirror blob safe serving policy", () => {
  let tmpDir;
  let registry;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-mirror-s3-"));
    registry = createMirrorJobRegistry({ ttlMs: 60_000 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupMirrorApp() {
    const { app } = makeApp({
      sessionStore: makeSessionStore(),
      userStore: makeUserStore(),
      deps: {
        fs,
        webhookSecret: null,
        mirrorJobRegistry: registry,
        remoteChannelManager: { attachMirroredMedia: vi.fn(async () => 1) },
      },
    });
    return app;
  }

  test("safe image still serves inline with the derived content type", async () => {
    const filePath = path.join(tmpDir, "a.jpg");
    fs.writeFileSync(filePath, "jpeg-bytes");
    const entry = registry.create({
      filePath,
      storedName: "mirror-a.jpg",
      originalName: "photo.jpg",
      mimeType: "image/jpeg",
    });
    const res = await request(setupMirrorApp())
      .get(`/api/remote-channel/blob/${entry.jobId}`)
      .set("x-chatdesk-mirror-secret", entry.secret);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-disposition"]).toBeUndefined();
    expect(Buffer.from(res.body).toString()).toBe("jpeg-bytes");
  });

  test("a client-controlled xml mime on an xml-looking name is forced to attachment + octet-stream", async () => {
    const filePath = path.join(tmpDir, "x.svgz");
    fs.writeFileSync(filePath, "svg-bytes");
    const entry = registry.create({
      filePath,
      storedName: "payload.svg",
      originalName: "payload.svg",
      // Attacker-supplied stored mime trying to render inline.
      mimeType: "image/svg+xml",
    });
    const res = await request(setupMirrorApp())
      .get(`/api/remote-channel/blob/${entry.jobId}`)
      .set("x-chatdesk-mirror-secret", entry.secret);
    expect(res.status).toBe(200);
    // .svg has no mapping in the extension allowlist and image/svg+xml is
    // not a safe served family — downgraded, attachment-forced.
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect(res.headers["content-disposition"]).toBe("attachment");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("a video/* mime with no safe inline extension is downgraded to attachment", async () => {
    const filePath = path.join(tmpDir, "clip.bin");
    fs.writeFileSync(filePath, "bytes");
    const entry = registry.create({
      filePath,
      storedName: "clip.weird",
      mimeType: "video/mp4",
    });
    const res = await request(setupMirrorApp())
      .get(`/api/remote-channel/blob/${entry.jobId}`)
      .set("x-chatdesk-mirror-secret", entry.secret);
    expect(res.status).toBe(200);
    // No extension mapping and video/* IS a safe served family, so the mime
    // is kept as the content type — but no safe inline extension means the
    // bytes ship as an attachment, never inline.
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["content-disposition"]).toBe("attachment");
  });
});
