import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  CirclePlus,
  Headset,
  LifeBuoy,
  Pencil,
  Refresh,
  LoaderCircle,
} from "../../icons/lucide.js";
import {
  api,
  cardCls,
  btnPrimary,
  btnSecondary,
  btnDanger,
  inputCls,
  labelCls,
  iconBtn,
  fmtDate,
} from "./adminShared.js";
import { EmptyState, TabToolbar } from "./AdminCommon.jsx";
import { useOverlayBack } from "../../hooks/chat/useOverlayBack.js";
import { hasPersian } from "../../utils/fontUtils.js";

const DEPARTMENT_COLORS = ["#10b981", "#0ea5e9", "#f59e0b", "#f43f5e", "#8b5cf6", "#14b8a6", "#f97316"];

/**
 * HelpdeskTab — the enterprise ticketing layer of the admin panel.
 *
 * Sections:
 *  1. Reports  — per-department volume / open conversations / operator load,
 *                plus the latest support conversations.
 *  2. Departments — create, edit, deactivate support departments.
 */
const HelpdeskTab = forwardRef(function HelpdeskTab({ active = true, onMutated }, ref) {
  const [departments, setDepartments] = useState([]);
  const [operatorsByDept, setOperatorsByDept] = useState({});
  const [overview, setOverview] = useState({ departments: [], chats: [] });
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");

  // Department create/edit modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // department row or null => create
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(DEPARTMENT_COLORS[0]);
  const [editorErr, setEditorErr] = useState("");
  const [saving, setSaving] = useState(false);
  useOverlayBack(Boolean(editorOpen), () => setEditorOpen(false), "sbAdminDeptModal");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [deptRes, ovRes] = await Promise.all([
        api.get("/api/admin/departments"),
        api.get("/api/admin/support/overview"),
      ]);
      setDepartments(deptRes?.departments ?? []);
      setOperatorsByDept(deptRes?.operatorsByDept ?? {});
      setOverview(ovRes ?? { departments: [], chats: [] });
    } catch {
      setError("Could not load helpdesk data.");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, []);

  useEffect(() => {
    if (active && !initialized) void refresh();
  }, [active, initialized, refresh]);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  function openCreate() {
    setEditing(null);
    setName("");
    setDescription("");
    setColor(DEPARTMENT_COLORS[departments.length % DEPARTMENT_COLORS.length]);
    setEditorErr("");
    setEditorOpen(true);
  }

  function openEdit(dept) {
    setEditing(dept);
    setName(dept.name);
    setDescription(dept.description || "");
    setColor(dept.color || DEPARTMENT_COLORS[0]);
    setEditorErr("");
    setEditorOpen(true);
  }

  async function saveDepartment(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setEditorErr("");
    try {
      const r = editing
        ? await api.patch(`/api/admin/departments/${editing.id}`, {
            name: name.trim(),
            description: description.trim(),
            color,
          })
        : await api.post("/api/admin/departments", {
            name: name.trim(),
            description: description.trim(),
            color,
          });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setEditorErr(d.error || "Failed to save department.");
        return;
      }
      setEditorOpen(false);
      await refresh();
      onMutated?.();
    } catch {
      setEditorErr("Request failed.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleDepartment(dept) {
    try {
      await api.patch(`/api/admin/departments/${dept.id}`, { active: !dept.active });
      await refresh();
    } catch {}
  }

  const overviewByDept = new Map(
    (overview.departments || []).map((d) => [Number(d.id), d])
  );

  const nameHasPersian = hasPersian(name);
  const descHasPersian = hasPersian(description);

  return (
    <div className="space-y-6">
      <TabToolbar>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LifeBuoy size={18} className="text-emerald-500 icon-anim-bob" />
          <h2 className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">
            Helpdesk
          </h2>
          <span className="hidden rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 sm:inline dark:bg-emerald-500/20 dark:text-emerald-300">
            ticketing
          </span>
        </div>
        <button type="button" onClick={openCreate} className={btnPrimary}>
          <CirclePlus size={15} className="icon-anim-pop" />
          New department
        </button>
        <button type="button" onClick={() => void refresh()} className={btnSecondary} aria-label="Refresh">
          <Refresh size={14} />
        </button>
      </TabToolbar>

      {error ? (
        <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {/* ─── Reports ──────────────────────────────────────────────────────── */}
      <section className={cardCls + " p-4"}>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Support reports
        </h3>
        {loading && !initialized ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500 dark:text-slate-400">
            <LoaderCircle size={16} className="animate-spin" />
            Loading reports...
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(overview.departments || []).map((d) => (
                <div
                  key={d.id}
                  className="rounded-2xl border border-emerald-100/70 bg-white/70 p-3 dark:border-emerald-500/20 dark:bg-slate-900/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100" dir="auto">
                      {d.name}
                    </span>
                    {!d.active ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        inactive
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <Metric label="Chats" value={d.chats} />
                    <Metric label="Open" value={d.open} tone={d.open > 0 ? "amber" : "slate"} />
                    <Metric label="Msgs" value={d.messages} />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {d.operators} operator{d.operators === 1 ? "" : "s"} on duty
                  </p>
                </div>
              ))}
              {!(overview.departments || []).length ? (
                <p className="col-span-full py-4 text-center text-xs text-slate-500 dark:text-slate-400">
                  No departments yet — create one to open the helpdesk.
                </p>
              ) : null}
            </div>

            {(overview.chats || []).length ? (
              <div className="mt-4">
                <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Latest support conversations
                </h4>
                <div className="app-scroll max-h-72 space-y-2 overflow-y-auto pr-1">
                  {(overview.chats || []).slice(0, 30).map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white/70 px-3 py-2.5 dark:border-white/5 dark:bg-slate-900/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" dir="auto">
                          {c.customerNickname || c.customerUsername}
                          <span className="ms-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                            {c.departmentName || "—"}
                          </span>
                          {c.operatorUsername ? (
                            <span className="ms-1.5 hidden text-[10px] text-slate-400 sm:inline">
                              → {c.operatorNickname || c.operatorUsername}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400" dir="auto">
                          {c.lastMessageBody || "(no messages)"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span
                          className={
                            "rounded-full px-2 py-0.5 text-[10px] font-bold " +
                            (c.lastMessageByCustomer
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
                              : "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300")
                          }
                        >
                          {c.lastMessageByCustomer ? "awaiting reply" : "handled"}
                        </span>
                        <p className="mt-1 text-[10px] text-slate-400">
                          {fmtDate(c.lastMessageAt || c.createdAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* ─── Departments ──────────────────────────────────────────────────── */}
      <section className={cardCls + " p-4"}>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Departments
        </h3>
        {loading && !initialized ? (
          <p className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">Loading...</p>
        ) : departments.length ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {departments.map((dept) => {
              const ops = operatorsByDept[dept.id] || [];
              return (
                <div
                  key={dept.id}
                  className={
                    "rounded-2xl border p-3 " +
                    (dept.active
                      ? "border-emerald-200/70 bg-white/70 dark:border-emerald-500/30 dark:bg-slate-900/50"
                      : "border-slate-200 bg-slate-50/70 opacity-70 dark:border-white/5 dark:bg-slate-900/30")
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-800 dark:text-slate-100" dir="auto">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: dept.color || "#10b981" }}
                        />
                        {dept.name}
                      </p>
                      {dept.description ? (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400" dir="auto">
                          {dept.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(dept)}
                        className={iconBtn("emerald")}
                        aria-label={`Edit ${dept.name}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleDepartment(dept)}
                        className={dept.active ? iconBtn("rose") : iconBtn("slate")}
                        aria-label={dept.active ? `Deactivate ${dept.name}` : `Activate ${dept.name}`}
                      >
                        {dept.active ? "⏸" : "▶"}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {ops.length ? (
                      ops.slice(0, 5).map((op) => (
                        <span
                          key={op.id}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          <Headset size={11} className="text-sky-500" />
                          {op.nickname || op.username}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-dashed border-amber-300 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:border-amber-500/40 dark:text-amber-300">
                        no operators yet
                      </span>
                    )}
                  </div>
                  {overviewByDept.get(Number(dept.id)) ? (
                    <p className="mt-2 text-[10px] text-slate-400">
                      {overviewByDept.get(Number(dept.id)).chats} conversations ·{" "}
                      {overviewByDept.get(Number(dept.id)).messages} messages
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState message="No departments yet — create one so customers can reach the right team." />
        )}
      </section>

      {/* ─── Department create/edit modal ─────────────────────────────────── */}
      {editorOpen ? (
        <div
          className="fixed inset-0 z-320 flex items-center justify-center overflow-y-auto bg-black/40 px-6 py-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dept-editor-title"
        >
          <form
            onSubmit={saveDepartment}
            className="w-full max-w-sm rounded-2xl border border-emerald-100/70 bg-white p-6 shadow-xl dark:border-emerald-500/30 dark:bg-slate-950"
          >
            <h3 id="dept-editor-title" className="text-lg font-semibold text-emerald-700 dark:text-emerald-200">
              {editing ? "Edit department" : "New department"}
            </h3>
            <div className="mt-4 space-y-3">
              <div>
                <label className={labelCls} htmlFor="dept-name">Name</label>
                <input
                  id="dept-name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setEditorErr(""); }}
                  placeholder="e.g. Technical Support"
                  lang={nameHasPersian ? "fa" : "en"}
                  dir={nameHasPersian ? "rtl" : "ltr"}
                  className={`mt-1.5 ${inputCls} ${nameHasPersian ? "font-fa text-right" : ""}`}
                  style={{ fontSize: "16px", unicodeBidi: "plaintext" }}
                  maxLength={80}
                  required
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="dept-desc">Description</label>
                <input
                  id="dept-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What does this team handle?"
                  lang={descHasPersian ? "fa" : "en"}
                  dir={descHasPersian ? "rtl" : "ltr"}
                  className={`mt-1.5 ${inputCls} ${descHasPersian ? "font-fa text-right" : ""}`}
                  style={{ fontSize: "16px", unicodeBidi: "plaintext" }}
                  maxLength={300}
                />
              </div>
              <div>
                <span className={labelCls}>Color</span>
                <div className="mt-2 flex gap-2">
                  {DEPARTMENT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`Use color ${c}`}
                      className={
                        "h-7 w-7 rounded-full transition " +
                        (color === c
                          ? "ring-2 ring-emerald-500 ring-offset-2 dark:ring-offset-slate-950"
                          : "opacity-70 hover:opacity-100")
                      }
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            {editorErr ? (
              <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/40 dark:text-rose-200">
                {editorErr}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setEditorOpen(false)} className={btnSecondary}>
                Cancel
              </button>
              <button type="submit" disabled={!name.trim() || saving} className={btnPrimary}>
                {saving ? <LoaderCircle size={14} className="animate-spin" /> : null}
                {editing ? "Save changes" : "Create department"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
});

function Metric({ label, value, tone = "slate" }) {
  const toneCls =
    tone === "amber"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300"
      : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  return (
    <div className={"rounded-xl px-2 py-1.5 " + toneCls}>
      <p className="text-sm font-bold leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-medium opacity-80">{label}</p>
    </div>
  );
}

export default HelpdeskTab;
