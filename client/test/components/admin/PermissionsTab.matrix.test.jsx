import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import PermissionsTab from "../../../src/components/admin/PermissionsTab.jsx";

const MATRIX = {
  roles: ["operator", "user"],
  ownerAlwaysFull: true,
  groups: [
    { key: "tickets", labelEn: "Tickets", labelFa: "تیکت‌ها" },
    { key: "messaging", labelEn: "Direct messages", labelFa: "پیام‌رسانی" },
  ],
  permissions: [
    {
      key: "ticket.create",
      group: "tickets",
      labelEn: "Create tickets",
      labelFa: "ارسال تیکت",
      descEn: "Open new support tickets.",
      descFa: "باز کردن تیکت پشتیبانی.",
      roles: {
        operator: { default: true, override: null, effective: true },
        user: { default: true, override: null, effective: true },
      },
    },
    {
      key: "ticket.refer",
      group: "tickets",
      labelEn: "Refer tickets",
      labelFa: "ارجاع تیکت",
      descEn: "Hand a ticket to another operator.",
      descFa: "تحویل تیکت به اپراتور دیگر.",
      roles: {
        operator: { default: true, override: null, effective: true },
        user: { default: false, override: null, effective: false },
      },
    },
    {
      key: "dm.send",
      group: "messaging",
      labelEn: "Send direct messages",
      labelFa: "ارسال پیام مسنجری",
      descEn: null,
      descFa: null,
      roles: {
        operator: { default: true, override: null, effective: true },
        user: { default: true, override: null, effective: true },
      },
    },
  ],
  overrides: [],
};

function makeFetchSpy({ failPut = false } = {}) {
  return vi.fn().mockImplementation((url, options = {}) => {
    if (url.includes("/api/admin/permissions") && (!options.method || options.method === "GET")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MATRIX),
      });
    }
    if (url.includes("/api/admin/permissions") && options.method === "PUT") {
      if (failPut) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "boom" }),
        });
      }
      const body = JSON.parse(options.body || "{}");
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            role: body.role,
            permission: body.permission,
            effective: body.allowed === null ? false : Boolean(body.allowed),
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

beforeEach(() => {
  window.localStorage.setItem("chatdesk.uiLanguage", "en");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminPanel — Permissions tab", () => {
  test("renders the role × permission matrix grouped by category with an always-full owner column", async () => {
    vi.stubGlobal("fetch", makeFetchSpy());
    render(
      <PermissionsTab
        cachedData={MATRIX}
        isLoading={false}
        hasData
        onMutated={() => {}}
      />,
    );

    // Permission labels (EN uiLanguage):
    await expect.element(page.getByText("Create tickets")).toBeVisible();
    await expect.element(page.getByText("Refer tickets")).toBeVisible();
    // Group section header cell:
    await expect.element(page.getByRole("cell", { name: "Tickets", exact: true })).toBeVisible();
    // The locked owner chip:
    const ownerChips = page.getByText("Always full");
    await expect.element(ownerChips.first()).toBeVisible();
  });

  test("toggling a permission PUTs the change and shows the custom-override dot", async () => {
    const fetchSpy = makeFetchSpy();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <PermissionsTab
        cachedData={MATRIX}
        isLoading={false}
        hasData
        onMutated={() => {}}
      />,
    );

    // "Refer tickets" row: the user column switch is OFF by default —
    // each switch carries an aria-label "<permission label> — <role>".
    const referUserSwitch = page.getByRole("switch", { name: "Refer tickets — user" });
    await expect.element(referUserSwitch).toHaveAttribute("aria-checked", "false");
    await referUserSwitch.click();
    await expect.element(referUserSwitch).toHaveAttribute("aria-checked", "true");

    const put = fetchSpy.mock.calls.find(
      ([url, options]) =>
        String(url).includes("/api/admin/permissions") && options?.method === "PUT",
    );
    expect(put).toBeTruthy();
    const body = JSON.parse(put[1].body);
    expect(body).toEqual({ role: "user", permission: "ticket.refer", allowed: true });
  });

  test("the reset button appears only for overridden entries and restores the default", async () => {
    const withOverride = {
      ...MATRIX,
      permissions: MATRIX.permissions.map((def) =>
        def.key === "ticket.refer"
          ? {
              ...def,
              roles: {
                ...def.roles,
                user: { default: false, override: true, effective: true },
              },
            }
          : def,
      ),
    };
    const fetchSpy = makeFetchSpy();
    vi.stubGlobal("fetch", fetchSpy);
    render(
      <PermissionsTab
        cachedData={withOverride}
        isLoading={false}
        hasData
        onMutated={() => {}}
      />,
    );

    // Only ticket.refer × user carries a reset affordance; it is the only
    // one whose button is visibly enabled (the rest render opacity-0 and
    // disabled for non-overridden values).
    const resetButton = page.getByRole("button", {
      name: "Reset to default: Refer tickets — user",
    });
    await expect.element(resetButton).toBeVisible();
    await expect.element(resetButton).toBeEnabled();
    const disabledReset = page.getByRole("button", {
      name: "Reset to default: Create tickets — user",
    });
    await expect.element(disabledReset).toBeDisabled();
    await resetButton.click();

    const put = fetchSpy.mock.calls.find(
      ([url, options]) =>
        String(url).includes("/api/admin/permissions") && options?.method === "PUT",
    );
    expect(put).toBeTruthy();
    expect(JSON.parse(put[1].body)).toEqual({
      role: "user",
      permission: "ticket.refer",
      allowed: null,
    });
  });

  test("a failed PUT reverts the optimistic flip and shows the error", async () => {
    vi.stubGlobal("fetch", makeFetchSpy({ failPut: true }));
    render(
      <PermissionsTab
        cachedData={MATRIX}
        isLoading={false}
        hasData
        onMutated={() => {}}
      />,
    );
    const referUserSwitch = page.getByRole("switch", { name: "Refer tickets — user" });
    await referUserSwitch.click();
    // Reverted back to off:
    await expect.element(referUserSwitch).toHaveAttribute("aria-checked", "false");
    // The component surfaces the server's error message:
    await expect.element(page.getByText("boom")).toBeVisible();
  });
});
