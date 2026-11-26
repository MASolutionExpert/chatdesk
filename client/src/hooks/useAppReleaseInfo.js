import { useCallback, useEffect, useState } from "react";
import { fetchAppInfo, fetchWhatsNew } from "../api/appMetaApi.js";

const WHATS_NEW_DISMISSED_VERSION_KEY = "chatdesk-whats-new-dismissed-version";

async function parseJsonResponse(response, fallbackMessage) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage);
  }
  return payload;
}

/**
 * App/release info + the per-version "What's new" payload.
 *
 * The server is the authority: GET /api/app/whats-new answers 200 ONLY for
 * the system owner and 403 (owner_only) for everyone else. A non-owner
 * simply gets whatsNewAvailable = false — the popup never opens and the
 * settings entry is not rendered. No client-side role guessing.
 */
export function useAppReleaseInfo() {
  const [appInfo, setAppInfo] = useState(null);
  const [appInfoLoading, setAppInfoLoading] = useState(true);
  const [appInfoError, setAppInfoError] = useState("");
  const [whatsNewData, setWhatsNewData] = useState(null);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  const loadAppInfo = useCallback(async () => {
    setAppInfoLoading(true);
    setAppInfoError("");
    try {
      const response = await fetchAppInfo();
      const payload = await parseJsonResponse(
        response,
        "Unable to load app information.",
      );
      setAppInfo(payload);

      // Owner-only what's new. Any failure (401/403/network) means the
      // current user is not the owner — silently no what's new at all.
      let whatsNew = null;
      try {
        const whatsNewResponse = await fetchWhatsNew();
        if (whatsNewResponse.ok) {
          whatsNew = await whatsNewResponse.json();
        }
      } catch {
        whatsNew = null;
      }
      setWhatsNewData(whatsNew);

      const currentVersion = String(whatsNew?.version || "").trim();
      const changelog = String(
        whatsNew?.currentChangelog || whatsNew?.changelog || "",
      ).trim();
      if (!currentVersion || !changelog) {
        setWhatsNewOpen(false);
        return payload;
      }
      const dismissedVersion = window.localStorage.getItem(
        WHATS_NEW_DISMISSED_VERSION_KEY,
      );
      setWhatsNewOpen(dismissedVersion !== currentVersion);
      return payload;
    } catch (error) {
      setAppInfoError(
        String(error?.message || "Unable to load app information."),
      );
      setWhatsNewOpen(false);
      return null;
    } finally {
      setAppInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAppInfo();
  }, [loadAppInfo]);

  const dismissWhatsNew = useCallback(
    (remember = true) => {
      if (remember && whatsNewData?.version) {
        window.localStorage.setItem(
          WHATS_NEW_DISMISSED_VERSION_KEY,
          String(whatsNewData.version),
        );
      }
      setWhatsNewOpen(false);
    },
    [whatsNewData],
  );

  const openWhatsNew = useCallback(() => {
    if (!whatsNewData) return;
    setWhatsNewOpen(true);
  }, [whatsNewData]);

  return {
    appInfo,
    appInfoLoading,
    appInfoError,
    loadAppInfo,
    whatsNewData,
    whatsNewAvailable: Boolean(whatsNewData),
    whatsNewOpen,
    openWhatsNew,
    dismissWhatsNew,
  };
}
