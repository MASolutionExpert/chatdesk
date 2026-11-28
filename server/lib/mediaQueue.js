import { Queue, Worker } from "bullmq";
import { dbKnex } from "../db/knex.js";
import { readEnvBool } from "../settings/env.js";

export function createMediaQueueManager({
  redisClient,
  storageProvider,
  s3ProcessingMode = "auto",
  s3ProcessingTimeoutMs,
  adminGetRow,
  adminRun,
  emitChatEvent,
  enqueueVideoTranscodeJob,
  transcodeVideosToH264,
  getSetting,
}) {
  const effectiveTimeoutMs = Math.max(
    0,
    Number(
      s3ProcessingTimeoutMs !== undefined
        ? s3ProcessingTimeoutMs
        : process.env.STORAGE_PROCESSING_TIMEOUT_MS || 120000,
    ) || 120000,
  );

  const isRealRedis =
    redisClient &&
    typeof redisClient.duplicate === "function" &&
    redisClient.constructor.name !== "InProcessRedisClient";

  let bullQueue = null;
  let bullWorker = null;
  const inMemoryQueue = [];
  const activeTimers = new Map();
  // fileId -> latest BullMQ jobId for the delayed fallback check, so
  // cancelFallbackCheck can remove the queued/delayed job from Bull.
  const bullJobIds = new Map();

  function toSql(builder) {
    if (builder && typeof builder.toSQL === "function") {
      const c = builder.toSQL();
      return { sql: c.sql, params: c.bindings || [] };
    }
    return { sql: builder, params: [] };
  }

  async function processMediaJob(jobData) {
    const { fileId, storageKey, reason } = jobData;
    if (!fileId) return;

    const { sql: checkSql, params: checkParams } = toSql(
      dbKnex("chat_message_files").where("id", fileId).first(),
    );
    // Check DB status to see if remote provider already processed it.
    // adminGetRow returns a PROMISE on Postgres (getRow is async there) and a
    // plain row on SQLite — awaiting both shapes is safe and was required:
    // without the await, `row.processing_status` was undefined on PG so the
    // "already processed" short-circuit never fired and `row.mime_type` was
    // undefined → isVideo false → the file was marked 'ready' and a
    // video:ready event was emitted while the worker was still transcoding.
    const row = adminGetRow
      ? await Promise.resolve(adminGetRow(checkSql, checkParams))
      : null;

    if (!row) return;
    if (row.processing_status === "ready") return; // Already processed by remote compute

    try {
      // Execute local fallback processing
      const isVideo = String(row.mime_type || "").toLowerCase().startsWith("video/");
      const isTranscodeEnabled = () => {
        if (typeof transcodeVideosToH264 === "boolean") return transcodeVideosToH264;
        if (typeof getSetting === "function") {
          const val = getSetting("FILE_UPLOAD_TRANSCODE_VIDEOS");
          if (val !== undefined && val !== null) return Boolean(val);
        }
        return readEnvBool("FILE_UPLOAD_TRANSCODE_VIDEOS", true);
      };

      if (isVideo && isTranscodeEnabled() && typeof enqueueVideoTranscodeJob === "function") {
        enqueueVideoTranscodeJob({
          fileId,
          storedName: row.stored_name,
          storageKey: row.storage_key || storageKey,
          storageDriver: row.storage_driver,
          messageId: row.message_id,
        });
      } else {
        // Update DB status to ready
        if (adminRun) {
          const { sql: updateSql, params: updateParams } = toSql(
            dbKnex("chat_message_files").where("id", fileId).update({ processing_status: "ready" }),
          );
          adminRun(updateSql, updateParams);
        }

        // Broadcast SSE notification
        if (typeof emitChatEvent === "function") {
          emitChatEvent("chatdesk:realtime-event", {
            type: "video:ready",
            fileId,
            storageKey: row.storage_key || storageKey,
          });
        }
      }
    } catch (err) {
      if (adminRun) {
        const { sql: failSql, params: failParams } = toSql(
          dbKnex("chat_message_files").where("id", fileId).update({ processing_status: "failed" }),
        );
        adminRun(failSql, failParams);
      }
    }
  }

  if (isRealRedis) {
    try {
      const connection = redisClient.options
        ? {
            host: redisClient.options.host,
            port: redisClient.options.port,
            username: redisClient.options.username,
            password: redisClient.options.password,
            db: redisClient.options.db,
          }
        : { host: "127.0.0.1", port: 6379 };

      bullQueue = new Queue("media-processing", { connection });
      bullWorker = new Worker(
        "media-processing",
        async (job) => {
          await processMediaJob(job.data);
        },
        { connection },
      );
    } catch (e) {
      bullQueue = null;
      bullWorker = null;
    }
  }

  function enqueueJob(data, delayMs = 0) {
    if (bullQueue) {
      // Unique jobId per schedule; the latest one is tracked per fileId so
      // cancellation removes exactly the pending delayed job.
      const jobId = `media-fallback-${data.fileId}-${Date.now()}`;
      bullJobIds.set(String(data.fileId), jobId);
      bullQueue.add("process-media", data, { delay: delayMs, jobId });
    } else {
      if (delayMs > 0) {
        const timer = setTimeout(() => {
          activeTimers.delete(String(data.fileId));
          processMediaJob(data);
        }, delayMs);
        if (typeof timer.unref === "function") timer.unref();
        activeTimers.set(String(data.fileId), timer);
      } else {
        inMemoryQueue.push(data);
        setImmediate(() => processMediaJob(data));
      }
    }
  }

  function scheduleFallbackCheck({ fileId, storageKey }) {
    if (s3ProcessingMode === "remote") return; // Pure remote, no local fallback timer

    // Read live so admin-panel changes apply without a restart.
    const liveTimeoutMs = typeof getSetting === "function"
      ? Number(getSetting("STORAGE_PROCESSING_TIMEOUT_MS"))
      : 0;
    enqueueJob(
      { fileId, storageKey, reason: "fallback_timer" },
      Number.isFinite(liveTimeoutMs) && liveTimeoutMs > 0 ? liveTimeoutMs : effectiveTimeoutMs,
    );
  }

  function cancelFallbackCheck(fileId) {
    const key = String(fileId);
    if (activeTimers.has(key)) {
      clearTimeout(activeTimers.get(key));
      activeTimers.delete(key);
    }
    // BullMQ path: actually remove the queued/delayed job. Best effort —
    // if the job already started (or finished) removal is a no-op.
    if (bullQueue) {
      const jobId = bullJobIds.get(key);
      if (jobId) {
        bullJobIds.delete(key);
        Promise.resolve(bullQueue.remove(jobId)).catch(() => {});
      }
    }
  }

  async function close() {
    for (const timer of activeTimers.values()) {
      clearTimeout(timer);
    }
    activeTimers.clear();
    bullJobIds.clear();

    if (bullWorker) await bullWorker.close();
    if (bullQueue) await bullQueue.close();
  }

  return {
    enqueueJob,
    scheduleFallbackCheck,
    cancelFallbackCheck,
    processMediaJob,
    close,
  };
}
