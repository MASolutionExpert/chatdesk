import { describe, it, expect, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2 HIGH (data review #3): the worker used to delete the original raw
// video from storage immediately after uploading the transcoded copy — but
// BEFORE notifying the server webhook. If all 5 callback retries failed, the
// server DB still pointed at the deleted original key and the file was lost.
//
// Fixed contract pinned here:
//  1. Callback delivered → the original raw video is deleted (no duplicates).
//  2. Callback never delivered → the original raw video SURVIVES (the DB
//     still points at it), and the just-uploaded transcoded copy is rolled
//     back best-effort so a broken callback endpoint cannot leak unbounded
//     orphaned duplicates.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("../ffmpeg.js", () => ({
  transcodeVideo: async ({ inputPath, outputPath }) => {
    await fs.promises.copyFile(inputPath, outputPath);
  },
  probeVideoMetadata: async () => ({
    widthPx: 1280,
    heightPx: 720,
    durationSeconds: 3.2,
  }),
  probeVideoDetails: async () => ({
    needsTranscode: true,
    videoCodec: "hevc",
    pixFmt: "yuv420p",
    formatName: "matroska,webm",
  }),
  faststartVideo: async () => {},
  generateThumbnail: async ({ outputPath }) => {
    await fs.promises.writeFile(outputPath, "fake-jpeg-thumb");
  },
}));

const { processTranscodeJob } = await import("../index.js");
const { createStorage } = await import("../storage.js");

function startCaptureServer({ callbackStatus = 200 } = {}) {
  const state = { callbackBody: null, callbackHits: 0 };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/bytes") {
      res.writeHead(200, { "Content-Type": "video/x-matroska" });
      return res.end(Buffer.from("fake-original-video-bytes"));
    }
    if (req.method === "POST" && req.url === "/callback") {
      let body = "";
      req.on("data", (c) => (body += String(c || "")));
      req.on("end", () => {
        state.callbackHits += 1;
        try {
          state.callbackBody = JSON.parse(body || "{}");
        } catch {
          state.callbackBody = {};
        }
        if (callbackStatus === 200) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end("{}");
        }
        res.writeHead(callbackStatus);
        return res.end("nope");
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        state,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function makeLocalStorage() {
  return createStorage({
    driver: "local",
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-transcode-")),
  });
}

describe("processTranscodeJob — original raw video deletion ordering", () => {
  it("deletes the original raw video only AFTER the callback is delivered", async () => {
    const cap = await startCaptureServer({ callbackStatus: 200 });
    const local = makeLocalStorage();
    const storageKey = "uploads/messages/orig-ready.mp4";
    // Seed the original raw file.
    const origPath = path.join(local.uploadDir, "orig-ready.mp4");
    await fs.promises.writeFile(origPath, Buffer.from("fake-original-video-bytes"));
    expect(await local.exists(storageKey)).toBe(true);

    try {
      await processTranscodeJob({
        fileId: "file-ready",
        storageKey,
        storedName: "orig-ready.mp4",
        callbackUrl: `http://127.0.0.1:${cap.port}/callback`,
        webhookSecret: "",
        storageConfig: {
          driver: "local",
          dataDir: local.uploadDir.replace(`${path.sep}uploads${path.sep}messages`, ""),
        },
        downloadUrl: `http://127.0.0.1:${cap.port}/bytes`,
        callbackMaxRetries: 1,
      });

      const cb = cap.state.callbackBody;
      expect(cb?.status).toBe("ready");
      expect(cb?.transcodedStorageKey).toBeTruthy();
      expect(cb?.transcodedStorageKey).not.toBe(storageKey);

      // Callback delivered → transcoded copy must exist, the original is gone.
      expect(await local.exists(cb.transcodedStorageKey)).toBe(true);
      expect(await local.exists(storageKey)).toBe(false);
    } finally {
      await cap.close();
    }
  });

  it("keeps the original raw video when every callback retry fails (no data loss)", async () => {
    const cap = await startCaptureServer({ callbackStatus: 500 });
    const local = makeLocalStorage();
    const storageKey = "uploads/messages/orig-fail.mp4";
    const origPath = path.join(local.uploadDir, "orig-fail.mp4");
    await fs.promises.writeFile(origPath, Buffer.from("fake-original-video-bytes"));
    expect(await local.exists(storageKey)).toBe(true);

    try {
      await processTranscodeJob({
        fileId: "file-fail",
        storageKey,
        storedName: "orig-fail.mp4",
        callbackUrl: `http://127.0.0.1:${cap.port}/callback`,
        webhookSecret: "",
        storageConfig: {
          driver: "local",
          dataDir: local.uploadDir.replace(`${path.sep}uploads${path.sep}messages`, ""),
        },
        downloadUrl: `http://127.0.0.1:${cap.port}/bytes`,
        callbackMaxRetries: 1,
      });

      expect(cap.state.callbackHits).toBe(1);

      // The DB still points at the original key → the original must survive.
      expect(await local.exists(storageKey)).toBe(true);

      // Bounded fallback: the orphaned transcoded copy is rolled back so a
      // permanently failing callback endpoint cannot grow storage forever.
      // Whatever it was, NOTHING except the original may remain for this job
      // (thumb aside), i.e. no unreferenced transcoded duplicate.
      const leftovers = fs
        .readdirSync(local.uploadDir)
        .filter((name) => name.startsWith("orig-fail") && name.endsWith(".mp4"));
      expect(leftovers).toEqual(["orig-fail.mp4"]);
    } finally {
      await cap.close();
    }
  });
});
