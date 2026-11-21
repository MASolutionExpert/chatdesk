import { apiFetch } from "./chatApi.js";
import {
  compareVersions,
  fetchLatestGitHubTag,
  normalizeVersion,
} from "../utils/versioning.js";

export const fetchAppInfo = () => apiFetch("/api/app/info");

export const checkAppVersion = async (appInfo = null) => {
  const owner = String(appInfo?.repository?.owner || "").trim();
  const repo = String(appInfo?.repository?.repo || "").trim();
  const currentVersion = normalizeVersion(appInfo?.version || "");
  const latestTag = await fetchLatestGitHubTag({
    owner,
    repo,
    // Only offer updates from the channel this install runs on
    // ("dev" prereleases vs "stable" releases).
    channel: appInfo?.channel,
  });
  const comparison = compareVersions(latestTag.normalizedTag, currentVersion);

  return {
    currentVersion,
    latestVersion: latestTag.normalizedTag,
    latestTag: latestTag.rawTag,
    status: comparison > 0 ? "update-available" : "up-to-date",
    repository: appInfo?.repository || null,
  };
};
