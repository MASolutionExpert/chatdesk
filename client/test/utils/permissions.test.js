import { describe, expect, test } from "vitest";
import {
  hasPermission,
  canUseFeature,
  chatMessageScope,
  messagePermissionKey,
  threadDeletePermissionKey,
} from "../../src/utils/permissions.js";

const FULL_REGISTRY = [
  "dm.send",
  "ticket.create",
  "ticket.close",
  "ticket.refer",
  "ticket.delete",
  "ticket.message.delete_any",
  "ticket.message.edit",
  "dm.thread.delete",
  "dm.message.delete_own",
  "dm.message.delete_any",
  "dm.message.edit",
  "call.voice",
  "call.video",
  "call.history.delete",
  "call.video.history.delete",
  "group.create",
  "channel.create",
  "chat.leave",
  "group.delete",
  "channel.delete",
  "group.message.delete_any",
  "group.message.edit",
];

describe("hasPermission", () => {
  test("the owner passes everything, even unknown keys", () => {
    const owner = { role: "owner", permissions: [] };
    expect(hasPermission(owner, "ticket.refer")).toBe(true);
    expect(hasPermission(owner, "made.up.key")).toBe(true);
  });

  test("an empty/missing permission array fails OPEN (server still enforces)", () => {
    expect(hasPermission({ role: "user" }, "ticket.refer")).toBe(true);
    expect(hasPermission({ role: "user", permissions: [] }, "ticket.refer")).toBe(true);
    expect(hasPermission(null, "dm.send")).toBe(false);
    expect(hasPermission(undefined, "dm.send")).toBe(false);
  });

  test("a populated array is the source of truth for non-owner roles", () => {
    const user = { role: "user", permissions: ["dm.send", "group.create"] };
    expect(hasPermission(user, "dm.send")).toBe(true);
    expect(hasPermission(user, "group.create")).toBe(true);
    expect(hasPermission(user, "ticket.refer")).toBe(false);
    expect(hasPermission(user, "dm.message.delete_any")).toBe(false);
  });

  test("role comparison is case-insensitive", () => {
    expect(hasPermission({ role: "OWNER", permissions: [] }, "dm.send")).toBe(true);
  });

  test("canUseFeature defaults to true for a missing user (display-only)", () => {
    expect(canUseFeature(null, "dm.send")).toBe(true);
    expect(canUseFeature({ role: "user", permissions: ["dm.send"] }, "dm.send")).toBe(true);
    expect(canUseFeature({ role: "user", permissions: [] }, "call.video")).toBe(true);
  });
});

describe("chat scope mapping (mirror of the server registry helpers)", () => {
  test("messenger DMs vs support tickets", () => {
    expect(chatMessageScope({ type: "dm", channel: "direct" })).toBe("dm");
    // 1.7.0-dev.8: the department is NOT the ticket identity — the thread
    // belongs to its customer↔operator pair, so a support-channel DM stays a
    // ticket even after its department was hard-deleted (null/dangling id).
    expect(chatMessageScope({ type: "dm", channel: "support", department_id: null })).toBe("ticket");
    expect(chatMessageScope({ type: "dm", channel: "support" })).toBe("ticket");
    expect(chatMessageScope({ type: "dm", channel: "support", department_id: "d1" })).toBe("ticket");
    expect(chatMessageScope({ type: "group", channel: "support", department_id: "d1" })).toBe("ticket");
    expect(chatMessageScope({ type: "group", channel: "support", department_id: null })).toBe("ticket");
    expect(chatMessageScope({ type: "group" })).toBe("group");
    expect(chatMessageScope({ type: "channel" })).toBe("group");
  });

  test("message permission keys compose scope + verb", () => {
    expect(messagePermissionKey({ type: "dm", channel: "direct" }, "edit")).toBe("dm.message.edit");
    expect(messagePermissionKey({ type: "group", channel: "support", department_id: "d1" }, "delete_any")).toBe(
      "ticket.message.delete_any",
    );
    expect(messagePermissionKey({ type: "group" }, "delete_own")).toBe("group.message.delete_own");
  });

  test("thread deletion keys split DM vs ticket", () => {
    expect(threadDeletePermissionKey({ type: "dm", channel: "direct" })).toBe("dm.thread.delete");
    expect(threadDeletePermissionKey({ type: "group", channel: "support", department_id: "d1" })).toBe(
      "ticket.delete",
    );
  });

  test("the client mirror never drifts: every key it can compose exists in the server registry", async () => {
    const { PERMISSION_DEFS } = await import("../../../server/lib/permissions.js");
    const serverKeys = new Set(PERMISSION_DEFS.map((d) => d.key));
    const chats = [
      { type: "dm", channel: "direct" },
      { type: "dm", channel: "support", department_id: "d1" },
      { type: "group" },
      { type: "channel" },
    ];
    for (const chat of chats) {
      for (const verb of ["edit", "delete_any"]) {
        expect(serverKeys.has(messagePermissionKey(chat, verb))).toBe(true);
      }
      // delete_own is a DM-scope-only registry entry — for ticket/group
      // scopes the composed key is intentionally unregistered and the
      // server resolves it to deny (fail-closed), matching the spec.
      const ownKey = messagePermissionKey(chat, "delete_own");
      expect(serverKeys.has(ownKey)).toBe(chatMessageScope(chat) === "dm");
    }
  });

  test("FULL_REGISTRY sample matches the server registry size", async () => {
    const { PERMISSION_DEFS } = await import("../../../server/lib/permissions.js");
    expect(PERMISSION_DEFS.length).toBeGreaterThanOrEqual(FULL_REGISTRY.length);
    for (const key of FULL_REGISTRY) {
      expect(PERMISSION_DEFS.some((d) => d.key === key)).toBe(true);
    }
  });
});
