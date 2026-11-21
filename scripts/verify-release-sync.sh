#!/usr/bin/env bash
# Release-sync gate (mandatory DevOps law for ChatDesk).
#
# Every change must ship together with the installer/CLI that delivers it.
# Before a release is registered, this script verifies that:
#   1. The VERSION file is non-empty.
#   2. The installer header (`# chatdesk-deploy-version:` in scripts/install.sh)
#      matches VERSION — this header is what the `chatdesk-deploy` CLI uses to
#      self-update, so a stale header means stale installs forever.
#   3. CHANGELOG.md documents the exact VERSION being released.
#   4. The channel pipeline functions referenced by the menu exist in the
#      installer (guards against menu/dispatch drift).
#
# Run locally:  bash scripts/verify-release-sync.sh
# CI:           a dedicated job in .github/workflows/build.yml runs it on
#               every push and pull request, on both dev and main.
#
# Exit code 0 = in sync, 1 = mismatch (release must not be registered).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0
fail_reason() {
  printf "FAIL: %s\n" "$1"
  fail=1
}

# 1. VERSION file
version=""
if [[ -f "$ROOT_DIR/VERSION" ]]; then
  version="$(head -n 1 "$ROOT_DIR/VERSION" | tr -d '\r\n' | xargs)"
fi
if [[ -z "$version" ]]; then
  fail_reason "VERSION file is missing or empty."
fi

# 2. Installer/CLI header version
header_version=""
if [[ -f "$ROOT_DIR/scripts/install.sh" ]]; then
  header_version="$(
    grep -E '^# chatdesk-deploy-version:' "$ROOT_DIR/scripts/install.sh" \
      | head -n 1 | cut -d ':' -f 2- | xargs
  )"
fi
if [[ -z "$header_version" ]]; then
  fail_reason "scripts/install.sh has no '# chatdesk-deploy-version:' header."
elif [[ -n "$version" && "$header_version" != "$version" ]]; then
  fail_reason "Installer header version ($header_version) does not match VERSION ($version). The chatdesk-deploy CLI would never self-update."
fi

# 3. CHANGELOG documents the released version
if [[ -n "$version" && -f "$ROOT_DIR/CHANGELOG.md" ]]; then
  if ! grep -Eq "^## ${version//./\\.}\s*$" "$ROOT_DIR/CHANGELOG.md"; then
    fail_reason "CHANGELOG.md has no '## $version' section."
  fi
fi

# 4. Channel pipeline functions referenced by the menu exist
if [[ -f "$ROOT_DIR/scripts/install.sh" ]]; then
  for fn in channel_label_for_branch detect_install_branch finalize_chatdesk_source_change switch_release_channel update_chatdesk; do
    if ! grep -Eq "^${fn}\(\) \{" "$ROOT_DIR/scripts/install.sh"; then
      fail_reason "scripts/install.sh is missing required function: ${fn}()"
    fi
  done
fi

# 5. Menu dispatch references only defined functions
if [[ -f "$ROOT_DIR/scripts/install.sh" ]]; then
  while IFS= read -r fn; do
    if ! grep -Eq "^${fn}\(\) \{" "$ROOT_DIR/scripts/install.sh"; then
      fail_reason "Menu dispatch calls undefined function: ${fn}()"
    fi
  done < <(
    grep -oE "run_menu_action [a-z_]+" "$ROOT_DIR/scripts/install.sh" \
      | awk '{print $2}' | sort -u
  )
fi

if [[ "$fail" -eq 0 ]]; then
  printf "release-sync OK: %s (VERSION, installer/CLI header and CHANGELOG are in sync)\n" "$version"
  exit 0
fi

printf "release-sync FAILED: fix the issues above before registering a release.\n"
exit 1
