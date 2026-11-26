import { useEffect, useMemo, useRef } from "react";

const DEFAULT_HOLD_DELAY_MS = 300;
const MOVE_TOLERANCE_PX = 12;
const SCROLL_INTENT_PX = 4;

const findScrollableAncestor = (node) => {
  if (typeof window === "undefined" || !node) return null;
  let current = node instanceof Element ? node : node?.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = String(style.overflowY || "").toLowerCase();
    const overflowX = String(style.overflowX || "").toLowerCase();
    const canScrollY =
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight;
    const canScrollX =
      (overflowX === "auto" || overflowX === "scroll") &&
      current.scrollWidth > current.clientWidth;
    if (canScrollY || canScrollX) {
      return current;
    }
    current = current.parentElement;
  }
  return document.scrollingElement || document.documentElement || null;
};

export function useContextMenuTrigger({
  disabled = false,
  isMobile = false,
  holdDelayMs = DEFAULT_HOLD_DELAY_MS,
  moveTolerancePx = MOVE_TOLERANCE_PX,
  // When true, a DESKTOP right-click that starts on an interactive child
  // (button/link/input inside this surface) does NOT open this surface's
  // menu — the inner element's own menu (if any) already handled the event
  // and bubbling must not overwrite it. Mirrors the interactive-child guard
  // the mobile long-press path below has always applied. Without this, e.g.
  // right-clicking a message's sender-name button inside a message bubble
  // opened the MESSAGE menu, instantly replacing the USER menu the sender
  // surface had just opened.
  skipInteractiveChild = false,
  onOpen,
}) {
  const holdTimerRef = useRef(null);
  // While a long-press timer is pending we also listen for the press's
  // release at the DOCUMENT level (capture phase). The surface's own
  // onPointerUp misses the release whenever the DOM churns between
  // pointerdown and pointerup — Chromium then retargets pointerup to the
  // nearest surviving ancestor, which is NOT this surface, so the timer
  // kept running and opened the context menu ~300ms AFTER the click had
  // already opened the profile modal (both stacked, menu on top — ugly).
  // Listening at document level makes ANY release of the pressing pointer
  // cancel the hold, no matter where the event retargets.
  const holdGuardDetachRef = useRef(null);
  // Set once the hold materialized (menu opened). While true, the press's
  // release installs a one-shot click swallow — the browser synthesizes a
  // click after the finger lifts, and it would land on whatever is on top
  // at that point (the freshly opened menu's backdrop), instantly closing
  // the menu the user asked for.
  const holdFiredRef = useRef(false);
  const clickSwallowDetachRef = useRef(null);
  const pointerRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollTarget: null,
    startScrollTop: 0,
    startScrollLeft: 0,
  });
  const suppressClickRef = useRef(false);

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(holdTimerRef.current);
    }
    holdTimerRef.current = null;
    const detachHold = holdGuardDetachRef.current;
    holdGuardDetachRef.current = null;
    if (typeof detachHold === "function") detachHold();
  };

  const detachClickSwallow = () => {
    const detach = clickSwallowDetachRef.current;
    clickSwallowDetachRef.current = null;
    if (typeof detach === "function") detach();
  };

  const attachClickSwallow = () => {
    if (typeof document === "undefined") return;
    const swallow = (event) => {
      detachClickSwallow();
      event.preventDefault();
      event.stopPropagation();
    };
    const detach = () => {
      document.removeEventListener("click", swallow, true);
      if (clickSwallowDetachRef.current === detach) {
        clickSwallowDetachRef.current = null;
      }
    };
    clickSwallowDetachRef.current = detach;
    document.addEventListener("click", swallow, true);
  };

  const attachHoldGuard = (pointerId) => {
    if (typeof document === "undefined") return;
    const onPointerEnd = (event) => {
      if (
        pointerId !== null &&
        Number(event?.pointerId) !== Number(pointerId)
      ) {
        return;
      }
      pointerRef.current.active = false;
      const holdHadFired = holdFiredRef.current;
      clearHoldTimer();
      // The hold materialized into an open menu and now the finger lifted:
      // swallow the synthesized click so it cannot close the menu (it
      // retargets to whatever overlay sits on top — the menu backdrop).
      if (holdHadFired) {
        attachClickSwallow();
      }
    };
    const detach = () => {
      document.removeEventListener("pointerup", onPointerEnd, true);
      document.removeEventListener("pointercancel", onPointerEnd, true);
      if (holdGuardDetachRef.current === detach) {
        holdGuardDetachRef.current = null;
      }
    };
    holdGuardDetachRef.current = detach;
    document.addEventListener("pointerup", onPointerEnd, true);
    document.addEventListener("pointercancel", onPointerEnd, true);
  };

  useEffect(() => () => {
    clearHoldTimer();
    detachClickSwallow();
  }, []);

  useEffect(() => {
    if (!isMobile || disabled) return undefined;
    const handleScroll = () => {
      if (!pointerRef.current.active) return;
      pointerRef.current.active = false;
      clearHoldTimer();
    };
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [disabled, isMobile]);

  return useMemo(() => {
    if (disabled || typeof onOpen !== "function") {
      return {};
    }

    const openMenu = (event, source = "desktop") => {
      const targetEl = event?.currentTarget || null;
      onOpen({
        event,
        source,
        targetEl,
        isMobile: source === "mobile",
      });
    };

    const onContextMenu = (event) => {
      if (isMobile) return;
      if (skipInteractiveChild) {
        const target = event.target instanceof Element ? event.target : null;
        const surface =
          event.currentTarget instanceof Element ? event.currentTarget : null;
        if (target && surface && target !== surface) {
          const interactive = target.closest(
            "button, a, input, textarea, select, [role='button']",
          );
          if (
            interactive &&
            surface.contains(interactive) &&
            interactive !== surface
          ) {
            return;
          }
        }
      }
      event.preventDefault();
      openMenu(event, "desktop");
    };

    const onPointerDown = (event) => {
      if (!isMobile || event.pointerType !== "touch") return;
      clearHoldTimer();
      // A stale swallow from a previous gesture would eat this press's
      // click — drop it; the press that matters starts now.
      detachClickSwallow();
      suppressClickRef.current = false;
      holdFiredRef.current = false;

      const target = event.target instanceof Element ? event.target : null;
      const surface = event.currentTarget instanceof Element ? event.currentTarget : null;
      if (target && surface && target !== surface) {
        const interactive = target.closest("button, a, input, textarea, select, [role='button']");
        if (interactive && surface.contains(interactive) && interactive !== surface) {
          return;
        }
      }

      const scrollTarget = findScrollableAncestor(event.target);
      pointerRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: Number(event.clientX || 0),
        startY: Number(event.clientY || 0),
        scrollTarget,
        startScrollTop: Number(scrollTarget?.scrollTop || 0),
        startScrollLeft: Number(scrollTarget?.scrollLeft || 0),
      };
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        // The hold materialized. KEEP the document-level guard attached —
        // the swipe wrapper holds pointer capture, so the surface itself
        // never sees pointerup; the guard still will, and on release it
        // swallows the synthesized click that would close this menu.
        holdFiredRef.current = true;
        suppressClickRef.current = true;
        pointerRef.current.active = false;
        openMenu(event, "mobile");
      }, holdDelayMs);
      attachHoldGuard(event.pointerId ?? null);
    };

    const cancelPointer = (event) => {
      if (!isMobile) return;
      if (!pointerRef.current.active) return;
      if (
        pointerRef.current.pointerId !== null &&
        Number(event?.pointerId) !== Number(pointerRef.current.pointerId)
      ) {
        return;
      }
      pointerRef.current.active = false;
      clearHoldTimer();
    };

    const onPointerMove = (event) => {
      if (!isMobile || !pointerRef.current.active) return;
      if (event.defaultPrevented) {
        cancelPointer(event);
        return;
      }
      const dx = Math.abs(
        Number(event.clientX || 0) - pointerRef.current.startX,
      );
      const dy = Math.abs(
        Number(event.clientY || 0) - pointerRef.current.startY,
      );
      const scrollTarget = pointerRef.current.scrollTarget;
      const scrollTop = Number(scrollTarget?.scrollTop || 0);
      const scrollLeft = Number(scrollTarget?.scrollLeft || 0);
      if (
        Math.abs(scrollTop - Number(pointerRef.current.startScrollTop || 0)) > 0 ||
        Math.abs(scrollLeft - Number(pointerRef.current.startScrollLeft || 0)) > 0
      ) {
        cancelPointer(event);
        return;
      }
      if (dy >= SCROLL_INTENT_PX && dy >= dx) {
        cancelPointer(event);
        return;
      }
      if (dx > moveTolerancePx || dy > moveTolerancePx) {
        cancelPointer(event);
      }
    };

    const onClickCapture = (event) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    return {
      onContextMenu,
      onPointerDown,
      onPointerMove,
      onPointerUp: cancelPointer,
      onPointerCancel: cancelPointer,
      onClickCapture,
    };
  }, [
    disabled,
    holdDelayMs,
    isMobile,
    moveTolerancePx,
    skipInteractiveChild,
    onOpen,
  ]);
}
