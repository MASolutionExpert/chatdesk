/**
 * Locale dictionaries, assembled from per-area namespaces.
 *
 * Each namespace module in `namespaces/` exports `{ en, fa }` objects with
 * identical key shapes. Keys are dot paths, e.g. `t("admin.users.title")`.
 * English is the structural fallback; Persian ('fa') is the system default.
 */
import { admin } from "./namespaces/admin.js";
import { auth } from "./namespaces/auth.js";
import { common } from "./namespaces/common.js";
import { settings } from "./namespaces/settings.js";
import { sidebar } from "./namespaces/sidebar.js";
import { chat } from "./namespaces/chat.js";
import { modals } from "./namespaces/modals.js";

export const en = {
  admin: admin.en,
  auth: auth.en,
  common: common.en,
  settings: settings.en,
  sidebar: sidebar.en,
  chat: chat.en,
  modals: modals.en,
};

export const fa = {
  admin: admin.fa,
  auth: auth.fa,
  common: common.fa,
  settings: settings.fa,
  sidebar: sidebar.fa,
  chat: chat.fa,
  modals: modals.fa,
};
