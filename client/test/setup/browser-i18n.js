/**
 * Browser-test i18n setup.
 *
 * ChatDesk ships bilingual UI (English + Persian) and defaults to Persian
 * (`DEFAULT_LANGUAGE = "fa"` in src/i18n/index.js). Most component tests were
 * written against the English labels ("Type a message", "Call failed", …), so
 * without seeding the persisted UI language every name-based locator
 * (`getByRole("textbox", { name: /type a message/i })`) fails after a 20 s
 * timeout — which is exactly what happened in CI: dozens of tests hung for 20
 * seconds each until the whole job hit its 10-minute limit.
 *
 * The LanguageProvider resolves the active language from
 * `localStorage["chatdesk.uiLanguage"]` on mount, so setting it here — before
 * any test module or component is loaded — pins every browser test to the
 * English dictionary. Tests that explicitly exercise Persian UI can override
 * this by setting the key to "fa" and remounting, as a few tests already do.
 *
 * (Some test files already seed the same key themselves; this setup makes the
 * behavior uniform instead of opt-in per file.)
 */
window.localStorage.setItem("chatdesk.uiLanguage", "en");
