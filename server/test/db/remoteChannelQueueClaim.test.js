import { describe, test, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Remote-channel queue claim semantics (Stage 2 HIGH data review #2 + #6).
//
// The claim used to return the SELECT snapshot even when the claim UPDATE
// ("... AND status IN ('pending','retry')") affected 0 rows — another
// instance's overlapping tick could mirror the same Telegram post twice.
// The UPDATE is now treated as the actual claim: 0 affected rows → null.
// The timestamp compares are dialect-specific now; this suite pins the
// SQLite (julianday) behaviour that must keep working. The Postgres dialect
// branches are pinned separately (remoteChannelQueuePostgresDialect.test.js).
// ─────────────────────────────────────────────────────────────────────────────

// Isolated SQLite database so claim assertions can't collide with other
// suites running against the shared dev database.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-queue-claim-"));

const {
  run,
  getRow,
  createChat,
  claimNextRemoteChannelQueueItem,
  releaseStaleRemoteChannelQueueItems,
  markRemoteChannelQueueItemRetry,
  markRemoteChannelQueueItemDone,
  purgeOldRemoteChannelQueueItems,
} = await import("../../db.js");

let seq = 0;

function seedChannelWithQueueItem({
  status = "pending",
  nextAttemptAt = null,
  createdAt = null,
}) {
  seq += 1;
  const chatId = createChat(`Queue Claim Test ${Date.now()} ${seq}`, "channel");
  run(
    `INSERT INTO remote_channel_sources
       (chat_id, provider, source_raw, source_chat_id, source_username, source_title,
        source_version, enabled, paused)
     VALUES (?, 'telegram', 'raw', 'src', 'src_user', 'Src Title', 1, 1, 0)`,
    [chatId],
  );
  const source = getRow(
    "SELECT id FROM remote_channel_sources WHERE chat_id = ?",
    [chatId],
  );

  const createdAtValue =
    createdAt || new Date(Date.now() - 60_000).toISOString();
  run(
    `INSERT INTO remote_channel_queue
       (source_id, provider, source_version, payload_json, status, next_attempt_at, created_at)
     VALUES (?, 'telegram', 1, '{}', ?, ?, ?)`,
    [source.id, status, nextAttemptAt, createdAtValue],
  );
  const item = getRow(
    "SELECT id FROM remote_channel_queue WHERE source_id = ? ORDER BY id DESC LIMIT 1",
    [source.id],
  );
  return { chatId, sourceId: source.id, itemId: item.id };
}

describe("claimNextRemoteChannelQueueItem (SQLite)", () => {
  test("claims a pending item and flips it to processing", () => {
    const { itemId } = seedChannelWithQueueItem({ status: "pending" });

    const claimed = claimNextRemoteChannelQueueItem("worker-a");

    expect(claimed).toBeTruthy();
    expect(Number(claimed.id)).toBe(Number(itemId));
    expect(claimed.status).toBe("processing");
    expect(claimed.lock_owner).toBe("worker-a");
    expect(claimed.locked_at).toBeTruthy();

    const row = getRow(
      "SELECT status, lock_owner FROM remote_channel_queue WHERE id = ?",
      [Number(itemId)],
    );
    expect(row.status).toBe("processing");
    expect(row.lock_owner).toBe("worker-a");
  });

  test("a claimed item is never handed out twice (no double mirroring)", () => {
    seedChannelWithQueueItem({ status: "pending" });

    const first = claimNextRemoteChannelQueueItem("worker-a");
    expect(first).toBeTruthy();

    // No other pending/retry rows exist in this isolated DB → the second
    // overlapping tick must get null, not the same snapshot again.
    const second = claimNextRemoteChannelQueueItem("worker-b");
    expect(second).toBeNull();
  });

  test("retry items with a past next_attempt_at are due again", () => {
    const { itemId } = seedChannelWithQueueItem({
      status: "retry",
      nextAttemptAt: new Date(Date.now() - 5_000).toISOString(),
    });

    const claimed = claimNextRemoteChannelQueueItem("worker-a");
    expect(claimed).toBeTruthy();
    expect(Number(claimed.id)).toBe(Number(itemId));
  });

  test("items with a future next_attempt_at are not due", () => {
    seedChannelWithQueueItem({
      status: "retry",
      nextAttemptAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    });

    const claimed = claimNextRemoteChannelQueueItem("worker-a");
    expect(claimed).toBeNull();
  });

  test("releaseStale flips stale processing items back to retry", () => {
    const { itemId } = seedChannelWithQueueItem({ status: "pending" });
    const lockedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    run(
      `UPDATE remote_channel_queue
       SET status = 'processing', locked_at = ?, lock_owner = 'ghost-worker'
       WHERE id = ?`,
      [lockedAt, Number(itemId)],
    );

    releaseStaleRemoteChannelQueueItems(new Date(Date.now() - 60_000).toISOString());

    const row = getRow(
      "SELECT status, locked_at, next_attempt_at FROM remote_channel_queue WHERE id = ?",
      [Number(itemId)],
    );
    expect(row.status).toBe("retry");
    expect(row.locked_at).toBeNull();
    expect(row.next_attempt_at).toBeTruthy();
  });

  test("releaseStale leaves freshly locked items alone", () => {
    const { itemId } = seedChannelWithQueueItem({ status: "pending" });
    const freshLock = new Date().toISOString();
    run(
      `UPDATE remote_channel_queue
       SET status = 'processing', locked_at = ?, lock_owner = 'live-worker'
       WHERE id = ?`,
      [freshLock, Number(itemId)],
    );

    releaseStaleRemoteChannelQueueItems(new Date(Date.now() - 60_000).toISOString());

    const row = getRow("SELECT status FROM remote_channel_queue WHERE id = ?", [
      Number(itemId),
    ]);
    expect(row.status).toBe("processing");
  });

  test("markRemoteChannelQueueItemRetry + claim keeps the retry cycle working", () => {
    const { itemId } = seedChannelWithQueueItem({ status: "pending" });
    const first = claimNextRemoteChannelQueueItem("worker-a");
    expect(first).toBeTruthy();

    markRemoteChannelQueueItemRetry(Number(itemId), {
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
      error: "boom",
    });

    const second = claimNextRemoteChannelQueueItem("worker-b");
    expect(second).toBeTruthy();
    expect(Number(second.id)).toBe(Number(itemId));
    expect(second.lock_owner).toBe("worker-b");
  });

  test("purgeOldRemoteChannelQueueItems deletes only old finished rows", () => {
    const { itemId } = seedChannelWithQueueItem({ status: "pending" });
    claimNextRemoteChannelQueueItem("worker-a");
    markRemoteChannelQueueItemDone(Number(itemId), "msg-1");

    // Old cutoff (ISO, 'T'-separated): processed_at (SQLite "YYYY-MM-DD
    // HH:MM:SS") sorts AFTER the year-2000 ISO prefix → row must survive.
    purgeOldRemoteChannelQueueItems("2000-01-01T00:00:00.000Z");
    expect(
      getRow("SELECT id FROM remote_channel_queue WHERE id = ?", [Number(itemId)]),
    ).toBeTruthy();

    // Far-future cutoff → row must be purged.
    purgeOldRemoteChannelQueueItems("9999-12-31T23:59:59.000Z");
    expect(
      getRow("SELECT id FROM remote_channel_queue WHERE id = ?", [Number(itemId)]),
    ).toBeNull();
  });
});
