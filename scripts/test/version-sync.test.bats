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

@test "verify-release-sync rejects a two-digit dev counter (dev.10 is forbidden)" {
  temp_dir="$(mktemp -d)"
  cp -r "$ROOT_DIR/scripts" "$temp_dir/scripts"
  cp "$ROOT_DIR/CHANGELOG.md" "$temp_dir/CHANGELOG.md"
  printf '1.2.0-dev.10\n' > "$temp_dir/VERSION"
  sed -i 's|^# chatdesk-deploy-version:.*|# chatdesk-deploy-version: 1.2.0-dev.10|' \
    "$temp_dir/scripts/install.sh"
  run bash "$temp_dir/scripts/verify-release-sync.sh"
  [ "$status" -ne 0 ]
  [[ "$output" == *"not a legal ChatDesk version"* ]]
  rm -rf "$temp_dir"
}

@test "next-dev-version increments the single-digit counter" {
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.2.0-dev.4
  [ "$status" -eq 0 ]
  [ "$output" = "1.2.0-dev.5" ]
}

@test "next-dev-version carries into the minor after dev.9" {
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.2.0-dev.9
  [ "$status" -eq 0 ]
  [ "$output" = "1.3.0-dev.1" ]
}

@test "next-dev-version carries into the major when the minor overflows" {
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.9.0-dev.9
  [ "$status" -eq 0 ]
  [ "$output" = "2.0.0-dev.1" ]
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 9.9.0-dev.9
  [ "$status" -eq 0 ]
  [ "$output" = "10.0.0-dev.1" ]
}

@test "next-dev-version starts the counter on a stable version" {
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.3.0
  [ "$status" -eq 0 ]
  [ "$output" = "1.3.0-dev.1" ]
}

@test "next-dev-version rejects any two-digit component" {
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.2.0-dev.10
  [ "$status" -ne 0 ]
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.10.0-dev.1
  [ "$status" -ne 0 ]
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.2.10
  [ "$status" -ne 0 ]
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" 1.2
  [ "$status" -ne 0 ]
  run bash "$ROOT_DIR/scripts/next-dev-version.sh" ""
  [ "$status" -ne 0 ]
}
