import { describe, it, expect } from "vitest";
import { createMediaQueueManager } from "../lib/mediaQueue.js";

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3 MEDIUM (F5): adminGetRow returns a PROMISE on Postgres (getRow is
// async there) and a plain row on SQLite. processMediaJob used to consume the
// value without awaiting it, so on PG `row.processing_status` was undefined
// (the "already processed" short-circuit never fired) and `row.mime_type` was
// undefined → isVideo false → the file was marked 'ready' and a video:ready
// event was emitted while the worker was still transcoding.
// ─────────────────────────────────────────────────────────────────────────────

const FILE_ID = "20000000-0000-4000-8000-000000000020";

describe("mediaQueue — async (Postgres-style) adminGetRow", () => {
  it("awaits a promised row and short-circuits when processing_status is ready", async () => {
    let markedReady = false;
    let eventEmitted = false;

    const manager = createMediaQueueManager({
      s3ProcessingMode: "auto",
      s3ProcessingTimeoutMs: 30,
      adminGetRow: () =>
        Promise.resolve({ id: FILE_ID, processing_status: "ready", mime_type: "video/mp4" }),
      adminRun: () => {
        markedReady = true;
      },
      emitChatEvent: (_n, payload) => {
        if (payload?.type === "video:ready") eventEmitted = true;
      },
    });

    await manager.processMediaJob({ fileId: FILE_ID });

    // Small settling delay: the old bug fired the event synchronously.
    await new Promise((res) => setTimeout(res, 20));
    expect(markedReady).toBe(false);
    expect(eventEmitted).toBe(false);

    await manager.close();
  });

  it("awaits a promised pending row: video mime → transcode path, NOT premature ready", async () => {
    let markedReady = false;
    let videoReadyEmitted = false;
    let enqueuedTranscode = null;

    const manager = createMediaQueueManager({
      s3ProcessingMode: "auto",
      s3ProcessingTimeoutMs: 30,
      adminGetRow: () =>
        Promise.resolve({
          id: FILE_ID,
          processing_status: "pending",
          mime_type: "video/quicktime",
          stored_name: "clip.mov",
          storage_key: "uploads/messages/clip.mov",
          message_id: "m1",
        }),
      adminRun: () => {
        markedReady = true;
      },
      emitChatEvent: (_n, payload) => {
        if (payload?.type === "video:ready") videoReadyEmitted = true;
      },
      enqueueVideoTranscodeJob: (payload) => {
        enqueuedTranscode = payload;
      },
      transcodeVideosToH264: true,
    });

    await manager.processMediaJob({ fileId: FILE_ID });

    // The video is routed to the transcode queue — the DB must NOT be marked
    // ready and no video:ready event may fire while transcoding is pending.
    expect(enqueuedTranscode?.fileId).toBe(FILE_ID);
    expect(enqueuedTranscode?.storedName).toBe("clip.mov");
    expect(markedReady).toBe(false);
    expect(videoReadyEmitted).toBe(false);

    await manager.close();
  });

  it("awaits a promised pending NON-video row: marks ready and emits video:ready (valid)", async () => {
    let markedReady = false;
    let eventEmitted = false;

    const manager = createMediaQueueManager({
      s3ProcessingMode: "auto",
      s3ProcessingTimeoutMs: 30,
      adminGetRow: () =>
        Promise.resolve({
          id: FILE_ID,
          processing_status: "pending",
          mime_type: "audio/mpeg",
          stored_name: "clip.mp3",
        }),
      adminRun: () => {
        markedReady = true;
      },
      emitChatEvent: (_n, payload) => {
        if (payload?.type === "video:ready") eventEmitted = true;
      },
      enqueueVideoTranscodeJob: () => {},
      transcodeVideosToH264: true,
    });

    await manager.processMediaJob({ fileId: FILE_ID });

    expect(markedReady).toBe(true);
    expect(eventEmitted).toBe(true);

    await manager.close();
  });

  it("handles a promised missing row (null) without throwing", async () => {
    const manager = createMediaQueueManager({
      s3ProcessingMode: "auto",
      s3ProcessingTimeoutMs: 30,
      adminGetRow: () => Promise.resolve(null),
      adminRun: () => {},
    });

    await expect(manager.processMediaJob({ fileId: FILE_ID })).resolves.toBeUndefined();
    await manager.close();
  });
});
