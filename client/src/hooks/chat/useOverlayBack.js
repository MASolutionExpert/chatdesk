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

// Module-level mirror of the sentinel entries currently in the history
// stack (bottom → top). A back() traversal removes EXACTLY the topmost
// entry, so the popstate handler can identify whose sentinel was popped
// by comparing against the stack top — instead of guessing from the
// remaining state, which cannot distinguish "the pop removed an entry
// ABOVE mine" (internal overlay bookkeeping, keep the UI as it is) from
// "the pop removed MY entry" (a genuine back gesture aimed at me).
//
// THE BUG THIS FIXES: with overlays stacked [chat, profile-modal, context-
// menu], closing the menu popped the menu's entry and landed on the MODAL's
// live sentinel. The chat's old handler saw "the new top is another LIVE
// sentinel" and concluded the pop had gone past it — calling closeChat()
// and throwing the user out of the conversation while the profile modal
// was still open. Reproduced by tapping a member's username in a referred
// support group → the member context menu ("Profile / Chat") → its
// close-pop silently killed the open chat page.
const sentinelStack = [];
let lastPopEvent = null;
let lastPoppedKey = null;
let lastDisposeEvent = null;

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
      if (pushedRef.current) {
        releasePushed(key);
        const idx = sentinelStack.lastIndexOf(key);
        if (idx !== -1) sentinelStack.splice(idx, 1);
      }
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
      sentinelStack.push(stateKey);
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
      // A back() traversal removes exactly the TOPMOST sentinel entry.
      // Identify it once per popstate event (every useOverlayBack instance
      // receives the same event object).
      if (lastPopEvent !== event) {
        lastPopEvent = event;
        lastPoppedKey = sentinelStack.pop() || null;
        lastDisposeEvent = null;
      }

      if (event.state?.[stateKey] === true) {
        // Moving FORWARD into our entry (re-navigation) — re-record it so
        // the stack mirrors history again.
        if (!sentinelStack.includes(stateKey)) sentinelStack.push(stateKey);
        return;
      }

      // The removed entry belonged to ANOTHER overlay — this pop was
      // internal bookkeeping (that overlay's own close-pop, or a stale-
      // entry disposal). Our own entry is still in place, so the UI must
      // NOT react: closing here threw users out of an open chat whenever
      // an overlay ABOVE it closed (profile modal + member context menu).
      if (lastPoppedKey !== stateKey) {
        // If the pop EXPOSED a stale sentinel on top (its owner released it
        // without popping — e.g. an overlay closed in the same commit that
        // another opened), dispose it with a follow-up back() so it cannot
        // eat a later genuine back gesture. Once per event.
        const topKey = sentinelKeyOf(window.history.state);
        if (
          topKey &&
          !isPushedKey(topKey) &&
          lastDisposeEvent !== event &&
          popTimerRef.current === null
        ) {
          lastDisposeEvent = event;
          setTimeout(() => {
            if (!isPushedKey(topKey) && window.history.state?.[topKey] === true) {
              window.history.back();
            }
          }, 0);
        }
        return;
      }

      if (!pushedRef.current) {
        // Our entry was popped while we are already released — either our
        // own deferred close-pop or a stale-entry disposal. Nothing to do.
        return;
      }
      pushedRef.current = false;
      releasePushed(stateKey);
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [stateKey]);
}
