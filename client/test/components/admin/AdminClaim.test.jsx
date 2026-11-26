import { describe, test, expect, vi, beforeEach } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import AdminPage from "../../../src/pages/AdminPage.jsx";

// ─── Emergency Claim UI — strictly gated (1.4.0-dev.8) ────────────────────────
//
// The ADMIN_API_TOKEN form renders ONLY when GET /api/app/info reports a
// genuine lockout (`adminClaimAvailable: true` — token configured AND no
// admin/owner exists) AND the viewer is not an impersonation (monitoring)
// session. Every other case renders a bilingual "Access denied" card with a
// back button and NO token input — the form is no longer a page every
// non-admin may stare at.

function stubAppInfo(fetchSpy, { adminClaimAvailable, claimOk = true }) {
  return fetchSpy.mockImplementation(async (url, _options) => {
    if (url.includes("/api/app/info")) {
      return {
        ok: true,
        json: async () => ({ adminClaimAvailable }),
      };
    }
    if (url.includes("/api/admin/claim")) {
      return claimOk
        ? { ok: true, json: async () => ({ ok: true, role: "owner" }) }
        : { ok: false, json: async () => ({ error: "Invalid token" }) };
    }
    return { ok: false, json: async () => ({}) };
  });
}

describe("AdminPage Emergency Claim UI", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders claim form for a non-admin ONLY on a real lockout", async () => {
    const fetchSpy = vi.fn();
    stubAppInfo(fetchSpy, { adminClaimAvailable: true });
    vi.stubGlobal("fetch", fetchSpy);
    const user = { id: 10, username: "alice", role: "user" };
    render(<AdminPage user={user} setUser={() => {}} onBack={() => {}} />);

    const heading = page.getByText("Emergency Claim");
    await expect.element(heading).toBeInTheDocument();

    const input = page.getByPlaceholder("Enter ADMIN_API_TOKEN");
    await expect.element(input).toBeInTheDocument();
  });

  test("healthy install (no lockout) shows Access denied — no token form", async () => {
    const fetchSpy = vi.fn();
    stubAppInfo(fetchSpy, { adminClaimAvailable: false });
    const user = { id: 10, username: "alice", role: "user" };
    render(<AdminPage user={user} setUser={() => {}} onBack={() => {}} />);

    const denied = page.getByText("Access denied");
    await expect.element(denied).toBeInTheDocument();

    const input = page.getByPlaceholder("Enter ADMIN_API_TOKEN");
    await expect.element(input).not.toBeInTheDocument();
  });

  test("monitoring (impersonation) session never sees the token form", async () => {
    const fetchSpy = vi.fn();
    stubAppInfo(fetchSpy, { adminClaimAvailable: true });
    const user = {
      id: 10,
      username: "alice",
      role: "user",
      impersonatedBy: { id: "owner-id", username: "owner" },
    };
    render(<AdminPage user={user} setUser={() => {}} onBack={() => {}} />);

    const denied = page.getByText("Access denied");
    await expect.element(denied).toBeInTheDocument();

    const input = page.getByPlaceholder("Enter ADMIN_API_TOKEN");
    await expect.element(input).not.toBeInTheDocument();
  });

  test("submits token and elevates role on success", async () => {
    const setUserMock = vi.fn();
    const fetchSpy = vi.fn();
    stubAppInfo(fetchSpy, { adminClaimAvailable: true, claimOk: true });
    vi.stubGlobal("fetch", fetchSpy);

    const user = { id: 10, username: "alice", role: "user" };
    render(<AdminPage user={user} setUser={setUserMock} onBack={() => {}} />);

    const input = page.getByPlaceholder("Enter ADMIN_API_TOKEN");
    await expect.element(input).toBeInTheDocument();
    await input.fill("valid-token");

    const submitBtn = page.getByRole("button", { name: "Claim Privileges" });
    await userEvent.click(submitBtn);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/claim"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "valid-token" }),
      }),
    );
    expect(setUserMock).toHaveBeenCalled();
    const updater = setUserMock.mock.calls[0][0];
    const updatedUser = typeof updater === "function" ? updater(user) : updater;
    expect(updatedUser).toEqual({ id: 10, username: "alice", role: "owner" });
  });

  test("shows error message on claim failure", async () => {
    const setUserMock = vi.fn();
    const fetchSpy = vi.fn();
    stubAppInfo(fetchSpy, { adminClaimAvailable: true, claimOk: false });
    vi.stubGlobal("fetch", fetchSpy);

    const user = { id: 10, username: "alice", role: "user" };
    render(<AdminPage user={user} setUser={setUserMock} onBack={() => {}} />);

    const input = page.getByPlaceholder("Enter ADMIN_API_TOKEN");
    await expect.element(input).toBeInTheDocument();
    await input.fill("wrong-token");

    const submitBtn = page.getByRole("button", { name: "Claim Privileges" });
    await userEvent.click(submitBtn);

    const errorMsg = page.getByText("Invalid token");
    await expect.element(errorMsg).toBeInTheDocument();
    expect(setUserMock).not.toHaveBeenCalled();
  });
});
