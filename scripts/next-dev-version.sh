#!/usr/bin/env bash
# Compute the NEXT dev version for ChatDesk (single source of truth for the
# release flow). Usage:
#
#   scripts/next-dev-version.sh            # prints next dev version from ./VERSION
#   scripts/next-dev-version.sh 1.2.0-dev.4
#   scripts/next-dev-version.sh --validate # exit 1 if VERSION is not a legal version
#
# Versioning law (carry scheme):
#   - A release is either stable  X.Y.Z  or a dev prerelease  X.Y.Z-dev.N.
#   - The dev counter N is a SINGLE digit, 1..9. There is no dev.10, ever.
#     Reason: GitHub's tags/releases pages sort tags alphabetically, so
#     "dev.10" would order BEFORE "dev.2" and scramble the history.
#   - When the next dev increment would reach .dev.10, it CARRIES into the
#     minor version instead:  1.2.0-dev.9  ->  1.3.0-dev.1
#     (and  1.9.0-dev.9 -> 2.0.0-dev.1,  9.9.0-dev.9 -> 10.0.0-dev.1).
#   - Stable bumps follow plain semver (1.3.0-dev.9 promotes to 1.3.0).
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

# Legal shapes: X.Y.Z  or  X.Y.Z-dev.N with N in 1..9 (single digit).
if ! [[ "$version" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)(-dev\.([1-9]))?$ ]]; then
  die "illegal version '$version' (expected X.Y.Z or X.Y.Z-dev.N with N in 1..9; dev counters above 9 are forbidden — carry into the minor instead)."
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

# ... otherwise carry into the minor: 1.2.0-dev.9 -> 1.3.0-dev.1
printf "%s.%s.0-dev.1\n" "$major" "$((minor + 1))"
