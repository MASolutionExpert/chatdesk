import { describe, test, expect } from "vitest";
import request from "supertest";
import { makeApp, makeSessionStore, makeUserStore } from "../helpers/makeApp.js";
import { BRANDING_DEFAULTS } from "../../lib/branding.js";

const ownerId = "a0000000-0000-4000-8000-000000000001";

// A real 1×1 PNG used as the uploaded logo payload.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makeOwnerApp(deps = {}) {
  const owner = { id: ownerId, username: "boss", nickname: "Boss", role: "owner" };
  const sessionStore = makeSessionStore();
  sessionStore.createSession(owner.id, "owner-session");
  const { app } = makeApp({
    sessionStore,
    userStore: makeUserStore([owner]),
    deps: {
      isUserOwner: (userId) => userId === ownerId,
      ...deps,
    },
  });
  return app;
}

function logoRequest(app) {
  const req = request(app).post("/api/admin/branding/logo");
  for (const size of [16, 32, 180, 192, 512]) {
    req.attach(`icon-${size}`, PNG_1PX, { filename: `icon-${size}.png`, contentType: "image/png" });
  }
  return req;
}

describe("GET /api/branding (public)", () => {
  test("returns the defaults with no custom logo for unconfigured installs", async () => {
    const app = makeOwnerApp();
    const res = await request(app).get("/api/branding");
    expect(res.status).toBe(200);
    expect(res.body.aboutLinks).toEqual(BRANDING_DEFAULTS.aboutLinks);
    expect(res.body.copyrightLabel).toBe("@MASolutionExpert");
    expect(res.body.logo).toBeNull();
    expect(res.body.logoUpdatedAt).toBeNull();
  });

  test("reflects owner updates and exposes logo URLs after upload", async () => {
    const app = makeOwnerApp();
    await request(app)
      .put("/api/admin/branding")
      .set("Cookie", "sid=owner-session")
      .send({ loginTitle: "Acme", loginTagline: "سازمان اکمه" });
    const upload = await logoRequest(app)
      .set("Cookie", "sid=owner-session");
    expect(upload.status).toBe(200);
    expect(upload.body.ok).toBe(true);

    const res = await request(app).get("/api/branding");
    expect(res.body.loginTitle).toBe("Acme");
    expect(res.body.loginTagline).toBe("سازمان اکمه");
    expect(res.body.logo?.logoUrl).toMatch(/^\/api\/branding\/logo\.png\?v=\d+$/);
    expect(res.body.logo?.faviconUrl).toMatch(/^\/api\/branding\/icon-32\.png\?v=\d+$/);
    expect(res.body.logoUpdatedAt).toBeTruthy();
  });

  test("re-uploading the logo changes the public URLs (cache-busting)", async () => {
    const app = makeOwnerApp();
    await logoRequest(app).set("Cookie", "sid=owner-session");
    const first = (await request(app).get("/api/branding")).body.logo?.logoUrl;
    await new Promise((resolve) => setTimeout(resolve, 15));
    await logoRequest(app).set("Cookie", "sid=owner-session");
    const second = (await request(app).get("/api/branding")).body.logo?.logoUrl;
    expect(second).toMatch(/^\/api\/branding\/logo\.png\?v=\d+$/);
    expect(second).not.toBe(first);
  });

  test("the copyright year token round-trips through the admin API", async () => {
    const app = makeOwnerApp();
    const put = await request(app)
      .put("/api/admin/branding")
      .set("Cookie", "sid=owner-session")
      .send({ copyrightYear: "2026" });
    expect(put.status).toBe(200);
    expect(put.body.config.copyrightYear).toBe("2026");
    const res = await request(app).get("/api/branding");
    expect(res.body.copyrightYear).toBe("2026");
  });
});

describe("GET /api/branding/icon-:size.png (public)", () => {
  test("404s while no custom logo exists and serves bytes after upload", async () => {
    const app = makeOwnerApp();
    const before = await request(app).get("/api/branding/icon-512.png");
    expect(before.status).toBe(404);

    await logoRequest(app).set("Cookie", "sid=owner-session");
    const after = await request(app).get("/api/branding/icon-512.png");
    expect(after.status).toBe(200);
    expect(after.headers["content-type"]).toMatch(/image\/png/);
    expect(Buffer.compare(Buffer.from(after.body), PNG_1PX)).toBe(0);
    // Unversioned requests must revalidate instead of trusting stale caches.
    expect(after.headers["cache-control"]).toMatch(/no-cache/);

    const versioned = await request(app).get(
      "/api/branding/icon-512.png?v=1234567890",
    );
    expect(versioned.status).toBe(200);
    expect(versioned.headers["cache-control"]).toMatch(/immutable/);

    const logo = await request(app).get("/api/branding/logo.png");
    expect(logo.status).toBe(200);
    expect(logo.headers["content-type"]).toMatch(/image\/png/);
  });

  test("rejects sizes outside the registry", async () => {
    const app = makeOwnerApp();
    await logoRequest(app).set("Cookie", "sid=owner-session");
    const res = await request(app).get("/api/branding/icon-64.png");
    expect(res.status).toBe(404);
  });
});

describe("GET/PUT /api/admin/branding", () => {
  test("is owner-gated", async () => {
    const app = makeOwnerApp();
    const anon = await request(app).get("/api/admin/branding");
    expect([401, 403]).toContain(anon.status);
    const anonPut = await request(app)
      .put("/api/admin/branding")
      .send({ loginTitle: "Hax" });
    expect([401, 403]).toContain(anonPut.status);
    const anonLogo = await request(app).post("/api/admin/branding/logo");
    expect([401, 403]).toContain(anonLogo.status);
    const anonDelete = await request(app).delete("/api/admin/branding/logo");
    expect([401, 403]).toContain(anonDelete.status);
  });

  test("PUT merges a partial patch and keeps defaults for the rest", async () => {
    const app = makeOwnerApp();
    const res = await request(app)
      .put("/api/admin/branding")
      .set("Cookie", "sid=owner-session")
      .send({ rightsText: "Custom proprietary sentence." });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.config.rightsText).toBe("Custom proprietary sentence.");
    expect(res.body.config.aboutLinks).toEqual(BRANDING_DEFAULTS.aboutLinks);
  });

  test("PUT rejects invalid patches with a 400", async () => {
    const app = makeOwnerApp();
    const res = await request(app)
      .put("/api/admin/branding")
      .set("Cookie", "sid=owner-session")
      .send({ aboutLinks: [{ icon: "twitter", href: "https://x.com" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown link icon/i);
  });

  test("every branding change is audited", async () => {
    const owner = { id: ownerId, username: "boss", nickname: "Boss", role: "owner" };
    const sessionStore = makeSessionStore();
    sessionStore.createSession(owner.id, "owner-session");
    const { app, deps } = makeApp({
      sessionStore,
      userStore: makeUserStore([owner]),
      deps: { isUserOwner: (userId) => userId === ownerId },
    });
    await request(app)
      .put("/api/admin/branding")
      .set("Cookie", "sid=owner-session")
      .send({ loginTitle: "Acme" });
    await logoRequest(app).set("Cookie", "sid=owner-session");
    const entries = deps.readAdminAuditLogs({ limit: 20 }).entries || [];
    expect(entries.find((e) => e.action === "branding.update")).toBeTruthy();
    expect(entries.find((e) => e.action === "branding.logo")).toBeTruthy();
  });
});

describe("POST/DELETE /api/admin/branding/logo", () => {
  test("uploads, then resets the logo back to the bundled defaults", async () => {
    const app = makeOwnerApp();
    const upload = await logoRequest(app).set("Cookie", "sid=owner-session");
    expect(upload.status).toBe(200);
    expect(upload.body.logo?.logoUrl).toMatch(/^\/api\/branding\/logo\.png\?v=\d+$/);

    const served = await request(app).get("/api/branding/icon-32.png");
    expect(served.status).toBe(200);

    const reset = await request(app)
      .delete("/api/admin/branding/logo")
      .set("Cookie", "sid=owner-session");
    expect(reset.status).toBe(200);
    expect(reset.body.config.logoUpdatedAt).toBeNull();

    const gone = await request(app).get("/api/branding/icon-32.png");
    expect(gone.status).toBe(404);
  });

  test("rejects uploads without a valid PNG for the mandatory sizes", async () => {
    const app = makeOwnerApp();
    const res = await request(app)
      .post("/api/admin/branding/logo")
      .set("Cookie", "sid=owner-session")
      .attach("icon-512", Buffer.from("fake"), { filename: "icon-512.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/icon-512/i);
  });
});
