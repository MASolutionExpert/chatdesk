import { useEffect, useRef } from "react";

// Module-level registry of live overlay sentinels. Maps a stateKey to the
// number of hook instances that currently have a sentinel pushed for it.
// It lets a popstate handler tell a LIVE overlay's sentinel apart from a
// STALE one — an entry left behind by an overlay that closed in the same
// commit in which another overlay opened (its deferred pop found a newer
// sentinel on top and was skipped, orphaning its history entry).
const pushedCounts = new Map();

function acquirePushed(stateKey) {
  pushedCounts.set(stateKey, (pushedCounts.get(stateKey) || 0) + 1);
}

function releasePushed(stateKey) {
  const count = pushedCounts.get(stateKey) || 0;
  if (count <= 1) pushedCounts.delete(stateKey);
  else pushedCounts.set(stateKey, count - 1);
}

function isPushedKey(stateKey) {
  return pushedCounts.has(stateKey);
}

// Sentinel history entries are pushed as { [stateKey]: true } with a single
// key named "sb" + PascalCase (the convention every useOverlayBack caller
// follows). Route navigations push {} states, so they never match.
function sentinelKeyOf(state) {
  if (!state || typeof state !== "object") return null;
  const keys = Object.keys(state);
  if (keys.length !== 1) return null;
  const key = keys[0];
  if (!/^sb[A-Z]/.test(key) || state[key] !== true) return null;
  return key;
}

// When `isOpen` becomes true, pushes a sentinel history entry; when the
// system back gesture pops that entry (popstate), calls onClose;
// when the overlay closes by other means, pops the sentinel to keep the
// history stack in sync with the UI. `stateKey` must be unique per overlay so
// stacked overlays ignore each other's pops.
export function useOverlayBack(isOpen, onClose, stateKey = "sbOverlayBack") {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const popTimerRef = useRef(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Stop tracking if the component unmounts while its sentinel is pushed,
  // so the entry it leaves behind is not mistaken for a live one.
  useEffect(() => {
    const key = stateKey;
    return () => {
      if (pushedRef.current) releasePushed(key);
    };
  }, [stateKey]);

  useEffect(() => {
    if (isOpen && !pushedRef.current) {
      // A fresh push makes any pending close-pop obsolete.
      if (popTimerRef.current !== null) {
        clearTimeout(popTimerRef.current);
        popTimerRef.current = null;
      }
      // Push a sentinel entry so the back gesture lands on us instead of
      // being handled by the OS (which would exit the app).
      window.history.pushState({ [stateKey]: true }, "");
      pushedRef.current = true;
      acquirePushed(stateKey);
    } else if (!isOpen && pushedRef.current) {
      pushedRef.current = false;
      releasePushed(stateKey);
      if (popTimerRef.current !== null) {
        clearTimeout(popTimerRef.current);
        popTimerRef.current = null;
      }
      // Pop the sentinel only if ours is the current (topmost) entry. The
      // check + pop is deferred one tick because a sibling overlay may be
      // opening in this same React commit (e.g. a context menu closing as
      // it opens a modal): pushing a history entry while a back() traversal
      // is still pending is unreliable in Chromium and can swallow or
      // misplace the push. By the time this timer runs the commit's own
      // pushState has already landed, so either ours is still topmost and
      // popping is safe, or a newer overlay's sentinel sits above ours and
      // we leave the entry in place — the popstate handler below then
      // disposes it once it becomes the topmost entry again.
      popTimerRef.current = setTimeout(() => {
        popTimerRef.current = null;
        if (window.history.state?.[stateKey] === true) {
          window.history.back();
        }
      }, 0);
    }
  }, [isOpen, stateKey]);

  useEffect(() => {
    const handlePopState = (event) => {
      if (!pushedRef.current) {
        // We are not open. If the pop landed on a stale sentinel of ours
        // (an entry we never popped because a newer overlay's push landed
        // on top when we closed), dispose it with a follow-up back(). Left
        // in place, such an entry makes OTHER open overlays misread the pop
        // that lands on it as a genuine back gesture and close themselves.
        if (
          event.state?.[stateKey] === true &&
          !isPushedKey(stateKey) &&
          popTimerRef.current === null
        ) {
          popTimerRef.current = setTimeout(() => {
            popTimerRef.current = null;
            if (
              !pushedRef.current &&
              window.history.state?.[stateKey] === true &&
              !isPushedKey(stateKey)
            ) {
              window.history.back();
            }
          }, 0);
        }
        return;
      }
      if (event.state?.[stateKey]) return; // moving forward into our entry
      // If the pop landed on another overlay's STALE sentinel, its owner
      // disposes it with a follow-up back(); treat this pop as internal
      // overlay bookkeeping, not as a genuine "user pressed back" gesture —
      // otherwise we would close while the UI should stay exactly as it is.
      const topKey = sentinelKeyOf(window.history.state);
      if (topKey && topKey !== stateKey && !isPushedKey(topKey)) return;
      pushedRef.current = false;
      releasePushed(stateKey);
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [stateKey]);
}
