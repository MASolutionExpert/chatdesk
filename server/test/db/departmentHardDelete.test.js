import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// hardDeleteDepartment — REAL database integration (SQLite).
//
// The admin DELETE /api/admin/departments/:id route used to soft-delete
// (active = 0), so "deleted" departments stayed in the DB forever and kept
// appearing as inactive ghosts. 1.7.0-dev.7 makes the route a true removal:
// the row is deleted, assigned operators are detached (department_id → NULL),
// and historical support chats/tickets keep their department_id values
// (message history intact — the dangling id simply matches no live row).
// ─────────────────────────────────────────────────────────────────────────────

// The sandbox/host may leak Postgres env vars; this suite is SQLite-only.
process.env.DB_CLIENT = "sqlite3";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "chatdesk-dept-harddel-"));

const {
  createDepartment,
  hardDeleteDepartment,
  getDepartmentById,
  listDepartments,
  createUser,
  setUserDepartment,
  getUserDepartmentId,
  createChat,
  addChatMember,
  markChatDepartment,
} = await import("../../db.js");

const open = (value) =>
  value && typeof value.then === "function" ? Promise.resolve(value) : value;

describe("hardDeleteDepartment — real database integration", () => {
  test("removes the row, detaches operators, keeps chat history intact", async () => {
    const dept = await open(createDepartment({ name: "Billing", description: "money" }));
    expect(dept?.id).toBeTruthy();

    const opId = createUser("harddel-op", "hash", "Op", null, null, { role: "operator" });
    await open(setUserDepartment(opId, dept.id));
    expect(await open(getUserDepartmentId(opId))).toBe(dept.id);

    // A historical support chat tagged with this department.
    const custId = createUser("harddel-cust", "hash", "Cust", null, null, { role: "user" });
    const chatId = await open(createChat([custId], "dm"));
    await open(addChatMember(chatId, opId));
    await open(markChatDepartment(chatId, dept.id));

    const deleted = await open(hardDeleteDepartment(dept.id));
    expect(deleted?.name).toBe("Billing");

    // Row is gone — both from the by-id lookup and the listing.
    expect(await open(getDepartmentById(dept.id))).toBeNull();
    const all = await open(listDepartments({ activeOnly: false }));
    expect(all.some((d) => d.id === dept.id)).toBe(false);

    // Operator detached.
    expect(await open(getUserDepartmentId(opId))).toBeNull();

    // Deleting again (or an unknown id) reports not-found instead of throwing.
    expect(await open(hardDeleteDepartment(dept.id))).toBeNull();
    expect(await open(hardDeleteDepartment(0))).toBeNull();
    expect(await open(hardDeleteDepartment("abc"))).toBeNull();
  });

  test("does not touch other departments or their operators", async () => {
    const keep = await open(createDepartment({ name: "Sales" }));
    const drop = await open(createDepartment({ name: "Temp" }));

    const opKeep = createUser("harddel-keep", "hash", "Keep", null, null, { role: "operator" });
    const opDrop = createUser("harddel-drop", "hash", "Drop", null, null, { role: "operator" });
    await open(setUserDepartment(opKeep, keep.id));
    await open(setUserDepartment(opDrop, drop.id));

    const deleted = await open(hardDeleteDepartment(drop.id));
    expect(deleted?.name).toBe("Temp");

    expect(await open(getDepartmentById(keep.id))).not.toBeNull();
    expect(await open(getUserDepartmentId(opKeep))).toBe(keep.id);
    expect(await open(getUserDepartmentId(opDrop))).toBeNull();
  });
});
