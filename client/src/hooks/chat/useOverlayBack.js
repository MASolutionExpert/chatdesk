import { useEffect, useRef } from "react";

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
    } else if (!isOpen && pushedRef.current) {
      pushedRef.current = false;
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
      // popping is safe, or a newer overlay's sentinel sits above ours
      // (e.g. an overlay closed while another stayed open) and we leave it
      // — the user's back gestures drain it and our entry no-ops in the
      // popstate handler.
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
      if (!pushedRef.current) return;
      if (event.state?.[stateKey]) return; // moving forward into our entry
      // A back() triggered by another overlay that closed in the same tick
      // (e.g. a context menu closing while it opens a modal) must NOT close
      // us. In that race our sentinel is still the current (topmost) entry,
      // while a genuine user back gesture pops our entry first. Only treat
      // the pop as "user pressed back" when our sentinel is no longer the
      // current entry.
      if (window.history.state?.[stateKey] === true) return;
      pushedRef.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [stateKey]);
}
