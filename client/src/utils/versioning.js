export function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/,
  );
  if (!match) return null;
  return {
    normalized,
    major: Number(match[1] || 0),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0),
    prerelease: String(match[4] || ""),
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;

  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;

  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && !b.prerelease) return -1;
  if (a.prerelease === b.prerelease) return 0;
  return comparePrerelease(a.prerelease, b.prerelease);
}

// Compare a single prerelease identifier per SemVer 2.0 rules:
// numeric identifiers are compared numerically (so 10 > 9 — a naive string
// comparison would wrongly order dev.10 before dev.9), alphanumeric
// identifiers lexically, and numeric identifiers always rank lower than
// alphanumeric ones.
function comparePrereleaseIdentifiers(a, b) {
  const aIsNumeric = /^\d+$/.test(a);
  const bIsNumeric = /^\d+$/.test(b);
  if (aIsNumeric && bIsNumeric) {
    const aNum = Number(a);
    const bNum = Number(b);
    if (aNum === bNum) return 0;
    return aNum > bNum ? 1 : -1;
  }
  if (aIsNumeric) return -1;
  if (bIsNumeric) return 1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

// Dot-separated prerelease identifiers compare left to right; a prerelease
// with fewer identifiers ranks lower when all shared identifiers are equal.
function comparePrerelease(a, b) {
  const aIds = a.split(".");
  const bIds = b.split(".");
  const length = Math.max(aIds.length, bIds.length);
  for (let i = 0; i < length; i++) {
    if (aIds[i] === undefined) return -1;
    if (bIds[i] === undefined) return 1;
    const result = comparePrereleaseIdentifiers(aIds[i], bIds[i]);
    if (result !== 0) return result;
  }
  return 0;
}

// GitHub paginates tag lists (default page size 30) and returns them in git
// ref order, not semver order — with more than one page of tags the newest
// release can easily sit on a later page. Fetch enough pages to cover the
// history, then pick the highest version locally.
const TAG_FETCH_PAGE_SIZE = 100;
const TAG_FETCH_MAX_PAGES = 3;

async function fetchAllSemverTags(owner, repo) {
  const collected = [];
  for (let page = 1; page <= TAG_FETCH_MAX_PAGES; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tags?per_page=${TAG_FETCH_PAGE_SIZE}&page=${page}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`GitHub responded with ${response.status}.`);
    }

    const tags = await response.json();
    if (!Array.isArray(tags)) break;
    collected.push(...tags);
    if (tags.length < TAG_FETCH_PAGE_SIZE) break;
  }
  return collected;
}

export async function fetchLatestGitHubTag({ owner, repo, channel } = {}) {
  if (!owner || !repo) {
    throw new Error("GitHub repository information is not configured.");
  }

  const tagList = await fetchAllSemverTags(owner, repo);
  const tagListEntries = Array.isArray(tagList) ? tagList : [];
  const isDevChannel = String(channel || "").trim().toLowerCase() === "dev";
  const semverTags = tagListEntries
    .map((tag) => {
      const rawTag = String(tag?.name || "").trim();
      const normalizedTag = normalizeVersion(rawTag);
      return rawTag && parseVersion(normalizedTag)
        ? { rawTag, normalizedTag }
        : null;
    })
    .filter(Boolean)
    // Release channels must stay separate: a Stable-channel install is only
    // offered stable tags (no -dev prereleases), while a Test-channel install
    // may follow prereleases.
    .filter(
      (entry) => isDevChannel || !parseVersion(entry.normalizedTag)?.prerelease,
    );

  if (!semverTags.length) {
    throw new Error("No version tags were found on GitHub.");
  }

  return semverTags.sort((left, right) =>
    compareVersions(right.normalizedTag, left.normalizedTag),
  )[0];
}
