#!/bin/sh
set -e

# Root-then-drop: if started as root (the image default, so legacy volumes
# created by older root-run images can be repaired), fix /app/data ownership
# and re-exec this script as the unprivileged chatdesk user. Never run the
# workload itself as root. When the container is started with a non-root
# `user:` (Compose), this branch is skipped entirely.
if [ "$(id -u)" = "0" ]; then
  if command -v gosu >/dev/null 2>&1; then
    chown -R chatdesk:chatdesk /app/data 2>/dev/null || true
    exec gosu chatdesk "$0" "$@"
  fi
  echo "[entrypoint] WARNING: running as root because gosu is unavailable." >&2
fi

WORKER_PORT="${WORKER_PORT:-8080}"
STORAGE_PROCESSING_MODE="${STORAGE_PROCESSING_MODE:-auto}"
START_LOCAL_WORKER="${START_LOCAL_WORKER:-auto}"
FILE_UPLOAD_TRANSCODE_VIDEOS="${FILE_UPLOAD_TRANSCODE_VIDEOS:-true}"
WORKER_URL="${WORKER_URL:-${MEDIA_WORKER_URL:-}}"

should_start_local_worker() {
  if [ "$START_LOCAL_WORKER" = "false" ]; then
    return 1
  fi
  if [ "$START_LOCAL_WORKER" = "true" ]; then
    return 0
  fi
  if [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "false" ] || [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "0" ] || [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "no" ] || [ "$FILE_UPLOAD_TRANSCODE_VIDEOS" = "off" ]; then
    return 1
  fi
  if [ "$STORAGE_PROCESSING_MODE" = "remote" ]; then
    return 1
  fi
  if [ "$STORAGE_PROCESSING_MODE" = "local" ] || [ "$STORAGE_PROCESSING_MODE" = "auto" ]; then
    return 0
  fi
  case "$WORKER_URL" in
    *127.0.0.1*|*localhost*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

if should_start_local_worker; then
  echo "[entrypoint] Starting local ChatDesk Media Worker on port ${WORKER_PORT}..."
  # Simple supervision: the loop restarts the worker if it crashes, so a
  # backgrounded one-shot `node ... &` cannot leave media processing silently
  # dead until the next container restart. The loop itself runs in the
  # background; signal handling is unaffected — PID 1 is still the exec'd
  # server process below, and stopping the container kills the whole process
  # tree (the sleep/loop children never outlive it).
  #
  # The loop exits as soon as the exec'd server process (our parent, unchanged
  # PID across exec) is gone, so it never outlives the main service — this
  # also keeps 'run ...' style tests (bats) from hanging on open pipes.
  (
    set +e
    parent_pid="$PPID"
    while :; do
      WORKER_PORT="${WORKER_PORT}" PORT="${WORKER_PORT}" DATA_DIR="${DATA_DIR:-/app/data}" node /app/worker/index.js
      echo "[entrypoint] Local media worker exited (code=$?); restarting in 1s..." >&2
      sleep 1
      kill -0 "$parent_pid" 2>/dev/null || exit 0
    done
  ) &
fi

exec "$@"
