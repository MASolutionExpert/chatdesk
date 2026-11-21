/**
 * ChatDesk i18n core.
 *
 * Tiny, dependency-free localization for the client. Two supported UI
 * languages: Persian ('fa', the system default) and English ('en').
 *
 * - Dictionaries live in `locales.js`, assembled from per-area namespaces in
 *   `namespaces/`. Keys are dot paths (`settings.language.title`).
 * - `LanguageProvider` holds the active language, persists it to the account
 *   via `PUT /api/profile/language` (so the preference follows the user across
 *   devices) and mirrors it in localStorage for an instant first paint.
 * - `useI18n()` exposes { lang, setLang, t }. `t(key, vars)` interpolates
 *   `{name}` placeholders and falls back to English, then to the key itself.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fa, en } from "./locales.js";

const DICTS = { fa, en };
const STORAGE_KEY = "chatdesk.uiLanguage";

export const LANGUAGES = [
  { code: "fa", label: "فارسی" },
  { code: "en", label: "English" },
];

export const DEFAULT_LANGUAGE = "fa";

function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "fa" || stored === "en" ? stored : null;
  } catch {
    return null;
  }
}

function storeLanguage(lang) {
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Storage may be unavailable (private mode); the server keeps the value.
  }
}

function resolvePath(dict, key) {
  let node = dict;
  for (const part of String(key).split(".")) {
    if (node === undefined || node === null || typeof node !== "object") {
      return undefined;
    }
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

function translate(lang, key, vars) {
  const value = resolvePath(DICTS[lang], key) ?? resolvePath(DICTS.en, key);
  if (value === undefined) return key;
  return interpolate(value, vars);
}

// Applies the language to <html> so browser text handling (screen readers,
// font selection, input methods) matches the UI language.
function applyDocumentLanguage(lang) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
}

const LanguageContext = createContext({
  lang: DEFAULT_LANGUAGE,
  setLang: () => {},
  t: (key, vars) => translate(DEFAULT_LANGUAGE, key, vars),
});

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => readStoredLanguage() || DEFAULT_LANGUAGE);

  useEffect(() => {
    applyDocumentLanguage(lang);
  }, [lang]);

  // Reconcile with the account preference once the session is known. The
  // server value wins if it differs (it is the cross-device source of truth).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile/language", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || (data.language !== "fa" && data.language !== "en")) return;
        setLangState((prev) => (prev === data.language ? prev : data.language));
        storeLanguage(data.language);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const setLang = useCallback((nextLang) => {
    if (nextLang !== "fa" && nextLang !== "en") return;
    setLangState(nextLang);
    storeLanguage(nextLang);
    applyDocumentLanguage(nextLang);
    fetch("/api/profile/language", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: nextLang }),
    }).catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  );

  return createElement(LanguageContext.Provider, { value }, children);
}

export function useI18n() {
  return useContext(LanguageContext);
}

// Non-React helpers (for modules outside components).
export function getLanguage() {
  try {
    return readStoredLanguage() || DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function translateKey(key, vars) {
  return translate(getLanguage(), key, vars);
}
