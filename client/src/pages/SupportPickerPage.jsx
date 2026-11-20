import { useEffect, useState } from "react";
import { LoaderCircle, LifeBuoy } from "../icons/lucide.js";
import { hasPersian } from "../utils/fontUtils.js";
import { listDepartments, createSupportRequest } from "../api/chatApi.js";
import { OPEN_CHAT_ID_KEY } from "../utils/chatPageConstants.js";

/**
 * SupportPickerPage — shown right after a customer signs up (and reachable
 * any time at /departments). The customer picks a department and sends the
 * first message; the server fairly-routes the conversation to the operator
 * with the fewest open conversations in that department.
 */
export default function SupportPickerPage({ user, onNavigateChat, onSkip }) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const messageHasPersian = hasPersian(message || "");

  useEffect(() => {
    let isMounted = true;
    listDepartments()
      .then((res) => res.json())
      .then((data) => {
        if (isMounted) setDepartments(Array.isArray(data?.departments) ? data.departments : []);
      })
      .catch(() => {
        if (isMounted) setError("Could not load departments.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  async function submit() {
    if (!selectedDept || !message.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await createSupportRequest({
        departmentId: selectedDept.id,
        message: message.trim(),
        creator: user?.username,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || "Unable to start the conversation.");
      }
      if (data?.chatId) {
        window.sessionStorage.setItem(OPEN_CHAT_ID_KEY, String(data.chatId));
      }
      onNavigateChat?.(data?.chatId);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <section className="relative w-full max-w-lg rounded-3xl border border-emerald-200/70 bg-white/80 p-6 shadow-2xl shadow-emerald-500/10 backdrop-blur-sm dark:border-white/5 dark:bg-slate-900/80 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-500/20">
          <LifeBuoy size={20} className="text-emerald-600 dark:text-emerald-300" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Welcome, {user?.nickname || user?.username}!
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Which department can help you today?
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500 dark:text-slate-400">
            <LoaderCircle size={18} className="animate-spin" />
            Loading departments...
          </div>
        ) : departments.length ? (
          <div className="app-scroll max-h-64 space-y-2 overflow-y-auto pr-1">
            {departments.map((dept) => (
              <button
                key={dept.id}
                type="button"
                onClick={() => {
                  setSelectedDept(dept);
                  setError("");
                }}
                className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
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
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400" dir="auto">
                    {dept.description}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No departments are available yet. You can start one later from the
            chat screen via <span className="font-semibold">Contact support</span>.
          </p>
        )}
      </div>

      {selectedDept ? (
        <div className="mt-5">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Your message to {selectedDept.name}
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
      ) : null}

      {error ? (
        <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/40 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!selectedDept || !message.trim() || submitting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/30 transition hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <LoaderCircle size={16} className="animate-spin" /> : null}
          Start conversation
        </button>
        <button
          type="button"
          onClick={() => onSkip?.()}
          className="w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
        >
          I&apos;ll do this later
        </button>
      </div>
    </section>
  );
}
