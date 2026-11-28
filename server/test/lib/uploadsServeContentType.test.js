/**
 * Stage 2 HIGH fix [F5] — stored XSS via client-controlled Content-Type on
 * GET /api/uploads/messages/:storedName (server/lib/uploads.js).
 *
 * Before the fix the route echoed the client multipart mimetype verbatim and
 * decided inline vs. attachment purely on the extension, so `x.png` uploaded
 * with `application/x-a+xml` was served inline and Chromium (which parses any
 * *+xml type as XML) would run XHTML scripts on the app origin.
 *
 * The route now derives the served Content-Type from the stored filename
 * extension via the shared policy in lib/uploadContentTypes.js and forces
 * Content-Disposition: attachment unless the file passes the safe inline
 * policy (safe extension AND non-XML/HTML mime).
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import multer from "multer";
import express from "express";
import request from "supertest";
import { createUploadTools } from "../../lib/uploads.js";

describe("GET /api/uploads/messages/:storedName — safe Content-Type & disposition", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-serve-mime-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  function makeAppWithRow(row) {
    const uploadTools = createUploadTools({
      fs,
      path,
      crypto,
      multer,
      adminGetRow: () => row,
      adminRun: () => {},
      adminSave: () => {},
      uploadRootDir: tmpDir,
      avatarUploadRootDir: path.join(tmpDir, "avatars"),
      fileUploadMaxSize: 10 * 1024 * 1024,
      fileUploadMaxFiles: 1,
      fileUploadMaxTotalSize: 10 * 1024 * 1024,
      storageEncryption: {
        encryptFileInPlace: () => {},
        decryptBuffer: (b) => b,
        decryptFileToBuffer: () => Buffer.from("file-bytes"),
        decryptFileRange: () => Buffer.from("file-bytes"),
        getDecryptedFileSize: () => 10,
      },
      storageProvider: null,
    });
    const app = express();
    uploadTools.registerUploadRoutes(app, { adminGetRow: () => row });
    return app;
  }

  const serve = (app, storedName) =>
    request(app).get(`/api/uploads/messages/${storedName}`);

  test.each([
    [
      "blocks the *+xml poisoned png (review finding F5)",
      { stored_name: "x.png", mime_type: "application/x-a+xml" },
      (res) => {
        expect(res.headers["content-type"]).toContain("image/png");
        expect(res.headers["content-type"]).not.toContain("xml");
        expect(res.headers["content-disposition"]).toContain("attachment");
      },
    ],
    [
      "keeps a legit mp4 inline",
      { stored_name: "clip.mp4", mime_type: "video/mp4" },
      (res) => {
        expect(res.headers["content-type"]).toContain("video/mp4");
        expect(res.headers["content-disposition"]).toBeUndefined();
      },
    ],
    [
      "keeps a legit png inline",
      { stored_name: "photo.png", mime_type: "image/png" },
      (res) => {
        expect(res.headers["content-type"]).toContain("image/png");
        expect(res.headers["content-disposition"]).toBeUndefined();
      },
    ],
    [
      "keeps a legit pdf inline",
      { stored_name: "doc.pdf", mime_type: "application/pdf" },
      (res) => {
        expect(res.headers["content-type"]).toContain("application/pdf");
        expect(res.headers["content-disposition"]).toBeUndefined();
      },
    ],
    [
      "forces attachment for svg (never renderable)",
      { stored_name: "evil.svg", mime_type: "image/svg+xml" },
      (res) => {
        expect(res.headers["content-type"]).toContain("application/octet-stream");
        expect(res.headers["content-disposition"]).toContain("attachment");
      },
    ],
    [
      "forces attachment for xhtml",
      { stored_name: "page.png", mime_type: "application/xhtml+xml" },
      (res) => {
        expect(res.headers["content-disposition"]).toContain("attachment");
      },
    ],
    [
      "forces attachment for xml documents",
      { stored_name: "data.xml", mime_type: "application/xml" },
      (res) => {
        expect(res.headers["content-type"]).toContain("application/octet-stream");
        expect(res.headers["content-disposition"]).toContain("attachment");
      },
    ],
    [
      "forces attachment for html",
      { stored_name: "page.html", mime_type: "text/html" },
      (res) => {
        expect(res.headers["content-type"]).toContain("application/octet-stream");
        expect(res.headers["content-disposition"]).toContain("attachment");
      },
    ],
    [
      "keeps unknown binaries as attachment with a neutral type",
      { stored_name: "archive.bin", mime_type: "application/octet-stream" },
      (res) => {
        expect(res.headers["content-type"]).toContain("application/octet-stream");
        expect(res.headers["content-disposition"]).toContain("attachment");
      },
    ],
  ])("%s", (_label, row, assertions) => {
    fs.writeFileSync(path.join(tmpDir, row.stored_name), "file-bytes");
    const app = makeAppWithRow(row);
    return serve(app, row.stored_name).then(assertions);
  });

  test("inline decision also honors ?download=1", async () => {
    fs.writeFileSync(path.join(tmpDir, "photo.png"), "file-bytes");
    const app = makeAppWithRow({ stored_name: "photo.png", mime_type: "image/png" });
    const res = await serve(app, "photo.png").query("download=1");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });
});
