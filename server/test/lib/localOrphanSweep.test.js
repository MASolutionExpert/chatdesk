import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createMessageFileJobs } from "../../lib/messageFileJobs.js";

// Files referenced by chat_message_files must survive the sweep; crashed
// multipart uploads (written by multer into the final uploads dir but never
// inserted into the DB) must be removed once they are old enough.
describe("pruneOrphanLocalUploadFiles", () => {
  const dirs = [];
  const makeDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-local-sweep-"));
    dirs.push(dir);
    return dir;
  };

  const makeJobs = ({ rows, uploadRootDir, adminGetAll }) =>
    createMessageFileJobs({
      adminGetAll: adminGetAll || (() => rows || []),
      adminGetRow: () => null,
      adminRun: () => {},
      adminSave: () => {},
      listMessageFilesByMessageIds: () => [],
      removeStoredFileNames: () => {},
      uploadRootDir,
      fs,
      path,
      getSetting: () => 0,
      storageProvider: null,
    });

  const touch = (dir, name, ageMs) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.from(name));
    if (ageMs) {
      const past = new Date(Date.now() - ageMs);
      fs.utimesSync(file, past, past);
    }
    return file;
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("removes old unreferenced strays and keeps referenced + fresh files", async () => {
    const dir = makeDir();
    const oldAge = 25 * 60 * 60 * 1000; // older than the 24h default guard
    touch(dir, "stray-crash-upload.jpg", oldAge);
    touch(dir, "referenced-message.png", oldAge);
    touch(dir, "referenced-video-thumb.jpg", oldAge);
    touch(dir, "referenced-via-storage-key.mp4", oldAge);
    touch(dir, "fresh-in-flight-upload.jpg", 0);

    const jobs = makeJobs({
      uploadRootDir: dir,
      rows: [
        { stored_name: "referenced-message.png", storage_key: null, thumb_storage_key: null },
        {
          stored_name: "some-other-name.mp4",
          storage_key: "uploads/messages/referenced-via-storage-key.mp4",
          thumb_storage_key: "uploads/messages/referenced-video-thumb.jpg",
        },
      ],
    });

    const result = await jobs.pruneOrphanLocalUploadFiles();
    expect(result.scanned).toBe(5);
    expect(result.removed).toBe(1);
    expect(result.removedNames).toEqual(["stray-crash-upload.jpg"]);
    expect(fs.existsSync(path.join(dir, "referenced-message.png"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "referenced-video-thumb.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "referenced-via-storage-key.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "fresh-in-flight-upload.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "stray-crash-upload.jpg"))).toBe(false);
  });

  test("never deletes anything when the DB cannot be consulted", async () => {
    const dir = makeDir();
    const oldAge = 48 * 60 * 60 * 1000;
    touch(dir, "old-stray.bin", oldAge);
    const jobs = makeJobs({
      uploadRootDir: dir,
      adminGetAll: () => {
        throw new Error("db down");
      },
    });
    const result = await jobs.pruneOrphanLocalUploadFiles();
    expect(result.removed).toBe(0);
    expect(fs.existsSync(path.join(dir, "old-stray.bin"))).toBe(true);
  });

  test("olderThanMs=0 removes even fresh unreferenced files (explicit mode)", async () => {
    const dir = makeDir();
    touch(dir, "fresh-stray.bin", 0);
    touch(dir, "referenced.bin", 0);
    const jobs = makeJobs({
      uploadRootDir: dir,
      rows: [{ stored_name: "referenced.bin" }],
    });
    const result = await jobs.pruneOrphanLocalUploadFiles({ olderThanMs: 0 });
    expect(result.removedNames).toEqual(["fresh-stray.bin"]);
    expect(fs.existsSync(path.join(dir, "referenced.bin"))).toBe(true);
  });

  test("handles a missing uploads directory gracefully", async () => {
    const dir = path.join(makeDir(), "does-not-exist");
    const jobs = makeJobs({ uploadRootDir: dir, rows: [] });
    const result = await jobs.pruneOrphanLocalUploadFiles();
    expect(result).toEqual({ scanned: 0, removed: 0, removedNames: [] });
  });
});
