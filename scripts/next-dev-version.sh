#!/usr/bin/env bash
# Compute the NEXT dev version for ChatDesk (single source of truth for the
# release flow). Usage:
#
#   scripts/next-dev-version.sh            # prints next dev version from ./VERSION
#   scripts/next-dev-version.sh 1.2.0-dev.4
#   scripts/next-dev-version.sh --validate # exit 1 if VERSION is not a legal version
#
# Versioning law (single-digit components):
#   - A release is either stable  X.Y.Z  or a dev prerelease  X.Y.Z-dev.N.
#   - minor, patch and the dev counter are all SINGLE digits (0..9; the dev
#     counter starts at 1). The major grows freely — it has no left-hand
#     component to carry into, so it is the only place a "10" may ever appear.
#   - Reason: GitHub's tags/releases pages sort tags ALPHABETICALLY. When
#     every visible component is one digit, alphabetical order always equals
#     chronological order ("dev.2" < "dev.9", "1.9.x" < "2.0.x") and the
#     releases page reads like a timeline.
#   - Carry rules — an increment that would produce a two-digit component
#     carries into the component on its left instead:
#         1.2.0-dev.9  ->  1.3.0-dev.1    (dev counter carries into minor)
#         1.9.0-dev.9  ->  2.0.0-dev.1    (minor overflow carries into major)
#   - Promotion maps X.Y.Z-dev.N -> stable X.Y.Z. When that stable tag already
#     exists (a second promotion inside one dev series), the promote workflow
#     bumps the stable base with the same carry law (1.2.1 -> 1.2.2,
#     1.2.9 -> 1.3.0, 1.9.9 -> 2.0.0) before tagging.
#   - dpkg --compare-versions (used by the chatdesk-deploy CLI for
#     self-update) compares numeric segments numerically, so every pair of
#     versions produced by this scheme compares correctly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

die() {
  printf "next-dev-version: %s\n" "$1" >&2
  exit 1
}

version=""
if [[ "${1:-}" == "--validate" ]]; then
  [[ -f "$ROOT_DIR/VERSION" ]] || die "VERSION file is missing."
  version="$(head -n 1 "$ROOT_DIR/VERSION" | tr -d '\r\n' | xargs)"
elif [[ $# -ge 1 ]]; then
  version="$1"
else
  [[ -f "$ROOT_DIR/VERSION" ]] || die "VERSION file is missing."
  version="$(head -n 1 "$ROOT_DIR/VERSION" | tr -d '\r\n' | xargs)"
fi

[[ -n "$version" ]] || die "VERSION is empty."

# Legal shapes: X.Y.Z or X.Y.Z-dev.N — minor, patch single digits (0..9),
# dev counter single digit 1..9. Two-digit components are forbidden: they
# scramble GitHub's alphabetical tag ordering.
if ! [[ "$version" =~ ^([0-9]+)\.([0-9])\.([0-9])(-dev\.([1-9]))?$ ]]; then
  die "illegal version '$version' (expected X.Y.Z or X.Y.Z-dev.N where minor, patch and N are single digits; nothing above 9 — overflow carries into the next component: 1.2.0-dev.9 -> 1.3.0-dev.1, 1.9.0-dev.9 -> 2.0.0-dev.1)."
fi

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
dev_n="${BASH_REMATCH[5]:-}"

if [[ "${1:-}" == "--validate" ]]; then
  printf "validate OK: %s\n" "$version"
  exit 0
fi

# Stable version -> first dev prerelease of the same base.
if [[ -z "$dev_n" ]]; then
  printf "%s-dev.1\n" "$version"
  exit 0
fi

# Single-digit counter: plain increment while N < 9 ...
if (( dev_n < 9 )); then
  printf "%s.%s.%s-dev.%d\n" "$major" "$minor" "$patch" "$((dev_n + 1))"
  exit 0
fi

# ... otherwise carry: 1.2.0-dev.9 -> 1.3.0-dev.1. A minor that would reach
# 10 carries into the major instead: 1.9.0-dev.9 -> 2.0.0-dev.1.
minor=$(( minor + 1 ))
if (( minor >= 10 )); then
  minor=0
  major=$(( major + 1 ))
fi
printf "%s.%s.0-dev.1\n" "$major" "$minor"
