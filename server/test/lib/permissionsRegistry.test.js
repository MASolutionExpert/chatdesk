import { describe, expect, test } from "vitest";
import {
  ALL_PERMISSION_KEYS,
  ALL_ROLES,
  CONFIGURABLE_ROLES,
  PERMISSION_DEFS,
  PERMISSION_GROUPS,
  callHistoryPermissionKey,
  chatMessageScope,
  getDefaultPermission,
  getPermissionDef,
  isKnownPermission,
  messagePermissionKey,
  resolveEffectivePermission,
  threadDeletePermissionKey,
} from "../../lib/permissions.js";

describe("permission registry integrity", () => {
  test("every permission has unique keys and complete bilingual metadata", () => {
    const keys = new Set();
    for (const def of PERMISSION_DEFS) {
      expect(def.key, "key required").toBeTruthy();
      expect(keys.has(def.key), `duplicate key ${def.key}`).toBe(false);
      keys.add(def.key);
      expect(PERMISSION_GROUPS.some((g) => g.key === def.group)).toBe(true);
      expect(def.labelEn).toBeTruthy();
      expect(def.labelFa).toBeTruthy();
      for (const role of CONFIGURABLE_ROLES) {
        expect(
          typeof def.defaults[role],
          `${def.key} missing default for ${role}`,
        ).toBe("boolean");
      }
      expect(def.defaults.owner).toBeUndefined(); // owner is never stored
    }
    expect(ALL_PERMISSION_KEYS).toHaveLength(PERMISSION_DEFS.length);
  });

  test("registry defaults reproduce the pre-1.7 hard-coded behaviour", () => {
    // Everyone could do these before:
    for (const key of [
      "dm.send",
      "ticket.create",
      "ticket.close",
      "call.voice",
      "call.video",
      "call.history.delete",
      "call.video.history.delete",
      "group.create",
      "channel.create",
      "chat.leave",
      "group.delete",
      "channel.delete",
    ]) {
      expect(getDefaultPermission("operator", key)).toBe(true);
      expect(getDefaultPermission("user", key)).toBe(true);
    }
    // Staff-only before:
    expect(getDefaultPermission("operator", "ticket.refer")).toBe(true);
    expect(getDefaultPermission("user", "ticket.refer")).toBe(false);
    // Moderators (owner/operator) could edit their own messages before:
    for (const key of [
      "ticket.message.edit",
      "dm.message.edit",
      "group.message.edit",
    ]) {
      expect(getDefaultPermission("operator", key)).toBe(true);
      expect(getDefaultPermission("user", key)).toBe(false);
    }
    // Owner-only before (delete anything, delete threads):
    for (const key of [
      "ticket.delete",
      "dm.thread.delete",
      "dm.message.delete_own",
      "dm.message.delete_any",
      "ticket.message.delete_any",
      "group.message.delete_any",
    ]) {
      expect(getDefaultPermission("operator", key)).toBe(false);
      expect(getDefaultPermission("user", key)).toBe(false);
    }
  });

  test("owner always resolves to allowed, even for unknown keys", () => {
    expect(getDefaultPermission("owner", "dm.send")).toBe(true);
    expect(getDefaultPermission("owner", "made.up.key")).toBe(true);
    expect(resolveEffectivePermission("owner", "made.up.key", {})).toBe(true);
  });

  test("unknown permissions are fail-closed for everyone except owner", () => {
    expect(getDefaultPermission("operator", "nope.nope")).toBe(false);
    expect(getDefaultPermission("user", "nope.nope")).toBe(false);
    expect(isKnownPermission("nope.nope")).toBe(false);
    expect(getPermissionDef("dm.send")).toBeTruthy();
  });

  test("overrides win over defaults; missing override falls back", () => {
    expect(resolveEffectivePermission("user", "ticket.refer", {})).toBe(false);
    expect(resolveEffectivePermission("user", "ticket.refer", { "ticket.refer": 1 })).toBe(true);
    expect(resolveEffectivePermission("operator", "dm.send", { "dm.send": 0 })).toBe(false);
    expect(resolveEffectivePermission("user", "ticket.refer", { "ticket.refer": true })).toBe(true);
    // Owner ignores overrides entirely (always full):
    expect(resolveEffectivePermission("owner", "dm.send", { "dm.send": 0 })).toBe(true);
  });

  test("roles catalogue places owner first and excludes it from configurable", () => {
    expect(ALL_ROLES[0]).toBe("owner");
    expect(CONFIGURABLE_ROLES).toEqual(["operator", "user"]);
    expect(CONFIGURABLE_ROLES.includes("owner")).toBe(false);
  });
});

describe("chat scope mapping", () => {
  test("messenger DMs map to the dm scope", () => {
    expect(chatMessageScope({ type: "dm", channel: "direct" })).toBe("dm");
    expect(
      chatMessageScope({ type: "dm", channel: "support", department_id: null }),
    ).toBe("dm");
  });

  test("support threads map to the ticket scope — DM-shaped or referred groups", () => {
    expect(
      chatMessageScope({ type: "dm", channel: "support", department_id: "d1" }),
    ).toBe("ticket");
    expect(
      chatMessageScope({ type: "group", channel: "support", department_id: "d1" }),
    ).toBe("ticket");
  });

  test("groups and channels map to the group scope", () => {
    expect(chatMessageScope({ type: "group", channel: "direct" })).toBe("group");
    expect(chatMessageScope({ type: "channel" })).toBe("group");
  });

  test("message permission keys compose scope + verb", () => {
    expect(messagePermissionKey({ type: "dm", channel: "direct" }, "edit")).toBe(
      "dm.message.edit",
    );
    expect(
      messagePermissionKey({ type: "group", channel: "support", department_id: "d1" }, "delete_any"),
    ).toBe("ticket.message.delete_any");
    expect(messagePermissionKey({ type: "group" }, "delete_own")).toBe(
      "group.message.delete_own", // intentionally not in the registry → deny
    );
    expect(isKnownPermission("group.message.delete_own")).toBe(false);
    expect(isKnownPermission("dm.message.delete_own")).toBe(true);
  });

  test("thread deletion keys: DMs vs tickets", () => {
    expect(threadDeletePermissionKey({ type: "dm", channel: "direct" })).toBe(
      "dm.thread.delete",
    );
    expect(
      threadDeletePermissionKey({ type: "dm", channel: "support", department_id: "d1" }),
    ).toBe("ticket.delete");
    expect(
      threadDeletePermissionKey({ type: "group", channel: "support", department_id: "d1" }),
    ).toBe("ticket.delete");
  });

  test("call history keys split voice and video", () => {
    expect(callHistoryPermissionKey("[[call:voice:ended:42]]")).toBe(
      "call.history.delete",
    );
    expect(callHistoryPermissionKey("[[call:video:ended]]")).toBe(
      "call.video.history.delete",
    );
    expect(callHistoryPermissionKey("hello")).toBeNull();
    expect(callHistoryPermissionKey(null)).toBeNull();
  });
});
