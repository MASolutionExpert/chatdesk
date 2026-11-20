import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { Close, LoaderCircle, LifeBuoy } from "../../icons/lucide.js";
import { hasPersian } from "../../utils/fontUtils.js";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { listDepartments, createSupportRequest } from "../../api/chatApi.js";

/**
 * SupportRequestModal — the helpdesk entry point.
 *
 * The customer picks a support department, writes their first message, and
 * the server fairly-routes the conversation to the operator with the fewest
 * open conversations in that department. The created chat is a regular DM,
 * so it shows up in the normal chat list.
 */
export default function SupportRequestModal({
  open,
  username,
  onClose,
  onCreated,
}) {
  const dialogRef = useRef(null);
  useFocusTrap(dialogRef, open);

  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const messageHasPersian = hasPersian(message || "");

  useEffect(() => {
    if (!open) return;
    let isMounted = true;
    setDepartmentsLoading(true);
    setError("");
    setSelectedDept(null);
    setMessage("");
    listDepartments()
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) setDepartments(Array.isArray(data?.departments) ? data.departments : []);
      })
      .catch(() => {
        if (isMounted) setError("Could not load departments.");
      })
      .finally(() => {
        if (isMounted) setDepartmentsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  async function submit() {
    if (!selectedDept || !message.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await createSupportRequest({
        departmentId: selectedDept.id,
        message: message.trim(),
        creator: username,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Unable to start the conversation.");
      }
      onCreated?.(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 px-6 py-6"
      style={{
        minHeight: "100dvh",
        height: "100dvh",
        paddingTop: "max(1.5rem, calc(env(safe-area-inset-top) + 1rem))",
        paddingBottom: "max(1.5rem, calc(env(safe-area-inset-bottom) + 1rem))",
        paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
        paddingRight: "max(1.5rem, env(safe-area-inset-right))",
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-request-modal-title"
        className="w-full max-w-sm rounded-2xl border border-emerald-100/70 bg-white p-6 shadow-xl dark:border-emerald-500/30 dark:bg-slate-950"
      >
        <div className="flex items-center justify-between">
          <h3
            id="support-request-modal-title"
            className="flex items-center gap-2 text-lg font-semibold text-emerald-700 dark:text-emerald-200"
          >
            <LifeBuoy size={18} className="text-emerald-500" />
            Contact support
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-full border border-rose-200 p-2 text-rose-600 transition hover:border-rose-300 hover:bg-rose-50 hover:shadow-[0_0_16px_rgba(244,63,94,0.2)] dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
            aria-label="Close support dialog"
          >
            <Close size={18} className="icon-anim-pop" />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Pick a department — your message goes straight to its team.
        </p>

        <div className="mt-4 space-y-2">
          {departmentsLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500 dark:text-slate-400">
              <LoaderCircle size={16} className="animate-spin" />
              Loading departments...
            </div>
          ) : departments.length ? (
            <div className="app-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
              {departments.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => setSelectedDept(dept)}
                  className={`w-full rounded-2xl border px-3 py-3 text-left text-sm transition ${
                    selectedDept?.id === dept.id
                      ? "border-emerald-500 border-2 bg-emerald-50 text-emerald-900 shadow-md dark:border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-100"
                      : "border-emerald-100/70 bg-white/80 text-slate-700 hover:border-emerald-300 dark:border-emerald-500/30 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900/50"
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold" dir="auto">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: dept.color || "#10b981" }}
                    />
                    {dept.name}
                  </span>
                  {dept.description ? (
                    <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400" dir="auto">
                      {dept.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-400">
              No departments are available yet. Ask an administrator to create one.
            </p>
          )}
        </div>

        <div className="mt-4">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Your message
          </label>
          <textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setError("");
            }}
            placeholder="Describe your issue..."
            rows={3}
            lang={messageHasPersian ? "fa" : "en"}
            dir={messageHasPersian ? "rtl" : "ltr"}
            className={`mt-2 w-full resize-none rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm text-slate-700 outline-hidden transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-300/60 dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100 ${
              messageHasPersian ? "font-fa text-right" : "text-left"
            }`}
            style={{ fontSize: "16px", unicodeBidi: "plaintext" }}
          />
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/40 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!selectedDept || !message.trim() || submitting}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <LoaderCircle size={16} className="animate-spin" /> : null}
          Start conversation
        </button>
      </div>
    </div>,
    document.body,
  );
}
