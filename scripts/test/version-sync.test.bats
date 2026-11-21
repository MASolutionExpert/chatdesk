#!/usr/bin/env bats
# Release-sync gate: the installer/CLI, VERSION file and CHANGELOG must all
# agree. This is the automated part of the DevOps law: every change ships
# together with the installer and CLI that deliver it.

setup() {
  ROOT_DIR="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
}

@test "verify-release-sync passes on a synced tree" {
  run bash "$ROOT_DIR/scripts/verify-release-sync.sh"
  echo "output: $output"
  [ "$status" -eq 0 ]
}

@test "verify-release-sync detects a stale installer header" {
  temp_dir="$(mktemp -d)"
  cp -r "$ROOT_DIR/scripts" "$temp_dir/scripts"
  cp "$ROOT_DIR/VERSION" "$temp_dir/VERSION"
  cp "$ROOT_DIR/CHANGELOG.md" "$temp_dir/CHANGELOG.md"
  # Simulate a stale header (the bug that froze chatdesk-deploy at dev.2)
  sed -i 's|^# chatdesk-deploy-version:.*|# chatdesk-deploy-version: 0.0.1|' \
    "$temp_dir/scripts/install.sh"
  run bash "$temp_dir/scripts/verify-release-sync.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"does not match VERSION"* ]]
  rm -rf "$temp_dir"
}

@test "verify-release-sync detects a missing CHANGELOG entry" {
  temp_dir="$(mktemp -d)"
  cp -r "$ROOT_DIR/scripts" "$temp_dir/scripts"
  cp "$ROOT_DIR/VERSION" "$temp_dir/VERSION"
  # CHANGELOG without any version sections must fail the gate
  printf '# Changelog\n\nplaceholder\n' > "$temp_dir/CHANGELOG.md"
  run bash "$temp_dir/scripts/verify-release-sync.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"CHANGELOG"* ]]
  rm -rf "$temp_dir"
}
