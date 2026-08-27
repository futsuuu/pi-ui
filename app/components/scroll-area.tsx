import { ScrollArea as Primitive } from "radix-ui";
import { useCallback, useEffect, useRef, type UIEvent } from "react";
import { cva, css, cx } from "styled-system/css";

const RESTORE_MARGIN = 48;
const RESTORE_POLL_MS = 50;
const RESTORE_GRACE_MS = 2000;

const rootStyle = css({
  flex: "1",
  minWidth: "0",
  minHeight: "0",
  width: "full",
  height: "full",
  overflow: "hidden",
});

const viewportStyle = css({
  width: "full",
  height: "full",
  minWidth: "0",
  minHeight: "0",
});

const confinementStyle = css({
  width: "full",
  contain: "inline-size",
});

const scrollbar = cva({
  base: {
    display: "flex",
    userSelect: "none",
    touchAction: "none",
    padding: "0.5",
    transitionProperty: "colors",
    transitionDuration: "fast",
    transitionTimingFunction: "out",
  },
  variants: {
    orientation: {
      vertical: { flexDirection: "row", width: "2" },
      horizontal: { flexDirection: "column", height: "2" },
    },
  },
});

const thumbStyle = css({
  position: "relative",
  flex: "1",
  borderRadius: "full",
  opacity: 0.3,
  transitionProperty: "opacity",
  transitionDuration: "fast",
  _hover: { opacity: 0.5 },
  backgroundColor: "scroll.bg",
});

const cornerStyle = css({ backgroundColor: "subtle.bg" });

/**
 * Finds a descendant element identified by a message key.
 *
 * @param root - The element whose descendants to search
 * @param key - The message key to match
 * @returns The matching element, or `null` if no descendant has the key
 */
function findMessageElement(root: HTMLElement, key: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>("[data-message-key]")) {
    if (el.dataset.messageKey === key) return el;
  }
  return null;
}

/**
 * Renders a scrollable viewport with optional bottom-following and position restoration.
 *
 * @param autoScroll - Enables automatic following of newly added content.
 * @param autoScrollOffset - Distance from the bottom that re-enables automatic following.
 * @param restoreTarget - Message key used to restore the initial viewport position.
 * @param onRestoreComplete - Called after restoration completes or falls back to the bottom.
 * @returns A configured scroll area with vertical and horizontal scrollbars.
 */
export function ScrollArea({
  children,
  autoScroll,
  autoScrollOffset = 50,
  className,
  viewportClassName,
  onScroll,
  restoreTarget,
  onRestoreComplete,
  disableHorizontalScroll,
  ref: forwardedRef,
  ...viewportProps
}: Primitive.ScrollAreaViewportProps &
  React.RefAttributes<HTMLDivElement> & {
    viewportClassName?: string;
    /**
     * Enables auto-scroll: pins the viewport to the bottom and keeps following
     * the newest content as it grows — even when that content renders
     * asynchronously (markdown, images, web fonts). Scrolling up temporarily
     * disables following; scrolling back to the bottom (within
     * `autoScrollOffset`) re-enables it. Re-pins jump straight to the bottom.
     * When omitted or `false`, auto-scroll is disabled.
     */
    autoScroll?: boolean;
    /**
     * Distance in px from the bottom at which the viewport is considered "at
     * the bottom". Used when re-enabling following. Defaults to `50`.
     */
    autoScrollOffset?: number;
    /**
     * Message key to restore when the viewport mounts (a shared display
     * anchor, not a pixel offset). Requires `autoScroll`; without it no
     * restoration runs and `onRestoreComplete` never fires. While a target
     * is present, the mount does
     * not pin to the bottom; once the target element has rendered and been
     * measured, the viewport scrolls it into view at the top with a small
     * margin and `onRestoreComplete` fires. When the target never appears
     * (compacted away, removed), it falls back to the bottom. `null`
     * preserves the current initial bottom-pinning behavior.
     */
    restoreTarget?: string | null;
    /** Called once per mount after restoration finished (or fell back). */
    onRestoreComplete?: () => void;
    /**
     * Renders no horizontal scrollbar: Radix then sets `overflow-x: hidden`
     * on the viewport, and the content is wrapped in a size-confinement box
     * so the pane can never widen past its own width (wide children are
     * clipped instead of scrolling). Use for panes whose content must never
     * scroll sideways.
     */
    disableHorizontalScroll?: boolean;
  }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Whether we are currently following the bottom of the content.
  const followingRef = useRef(!!autoScroll);
  // Whether restoration has finished on this mount: the initial bottom pin is
  // skipped while the anchor is pending, and later effect re-runs (a changed
  // cursor after revalidation) never re-pin over a restored position.
  const restoredOnceRef = useRef(false);
  // Wall-clock deadline for the anchor to appear; kept outside the effect so
  // a re-run (changed restoreTarget) does not extend the wait. A deadline
  // instead of a poll-attempt count keeps the grace period bounded even when
  // the browser throttles timers under load.
  const restoreDeadlineRef = useRef(0);
  // Set on a user scroll input (wheel / touch / keyboard / scrollbar drag) so
  // that the following `scroll` event is attributed to the user rather than to
  // layout changes (async content growth or a viewport resize) that the browser
  // can also fire scroll events for.
  const pendingUserScrollRef = useRef(false);
  // Last scrollTop, used to detect the direction of a user scroll.
  const prevScrollTopRef = useRef(0);

  // Combine the forwarded ref (used by callers to read scroll metrics) with the
  // internal viewport ref (used to programmatically scroll to the bottom).
  const setViewportRef = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as { current: unknown }).current = node;
      }
    },
    [forwardedRef],
  );

  const atBottom = useCallback(
    (vp: HTMLDivElement) => vp.scrollHeight - vp.scrollTop - vp.clientHeight <= autoScrollOffset,
    [autoScrollOffset],
  );

  const scrollToBottom = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    // Avoid layout churn when the view already sits at the bottom.
    const target = vp.scrollHeight - vp.clientHeight;
    if (target <= 0 || Math.abs(vp.scrollTop - target) < 1) return;
    vp.scrollTo({ top: target });
  }, []);

  // Mark the next scroll event as user-initiated. Attached to the Root so that
  // scrollbar thumb drags (rendered as siblings of the viewport) are covered too.
  useEffect(() => {
    if (!autoScroll) return;
    const root = rootRef.current;
    if (!root) {
      return;
    }
    const markUser = () => {
      pendingUserScrollRef.current = true;
    };
    root.addEventListener("wheel", markUser, { passive: true });
    root.addEventListener("touchstart", markUser, { passive: true });
    root.addEventListener("touchmove", markUser, { passive: true });
    root.addEventListener("keydown", markUser);
    root.addEventListener("pointerdown", markUser);
    return () => {
      root.removeEventListener("wheel", markUser);
      root.removeEventListener("touchstart", markUser);
      root.removeEventListener("touchmove", markUser);
      root.removeEventListener("keydown", markUser);
      root.removeEventListener("pointerdown", markUser);
    };
  }, [autoScroll]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onScroll?.(event);
      const vp = viewportRef.current;
      if (!vp) {
        return;
      }
      const prevTop = prevScrollTopRef.current;
      const currentTop = vp.scrollTop;
      prevScrollTopRef.current = currentTop;

      // Scrolls not preceded by a user input gesture (content growth, viewport
      // resizes, our own re-pinning) must never toggle following — otherwise a
      // sudden height change would break the follow.
      if (!pendingUserScrollRef.current) {
        return;
      }
      // On threaded-scrolling platforms (e.g. Windows) a scroll event can be
      // dispatched before the new scroll position is committed, so it reads
      // the same position as the previous one. Keep the pending marker for the
      // event that reflects the actual movement instead of misattributing the
      // gesture (e.g. treating a stale "at the bottom" read as a re-enable).
      if (currentTop === prevTop) {
        return;
      }
      pendingUserScrollRef.current = false;

      if (atBottom(vp)) {
        // The user scrolled back to the bottom: resume following.
        followingRef.current = true;
      } else if (currentTop < prevTop) {
        // The user scrolled away from the bottom: stop following.
        followingRef.current = false;
      }
    },
    [onScroll, atBottom],
  );

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const vp = viewportRef.current;
    if (!vp) {
      return;
    }

    // "Restore" means the shared anchor message must be scrolled into view
    // before normal auto-scroll behavior resumes; it only applies while the
    // mount has not restored anything yet (a re-run with a changed cursor
    // after revalidation must not re-pin over the user's position).
    const restoring = restoreTarget != null && !restoredOnceRef.current;

    const recordPosition = () => {
      // Record the pinned position right away: the browser's own scroll event
      // for the pin may be delayed or coalesced, and direction detection needs
      // an accurate previous position to tell "scrolled up" from a stale first
      // event.
      prevScrollTopRef.current = vp.scrollTop;
      followingRef.current = atBottom(vp);
    };

    const finish = (pinned: boolean) => {
      restoredOnceRef.current = true;
      restoreDeadlineRef.current = 0;
      if (pinned) {
        // Pin to the bottom immediately; content that has not been laid out
        // yet (async markdown, fonts, images) re-pins via the ResizeObserver
        // below, so the initial load always ends at the bottom.
        scrollToBottom();
      }
      recordPosition();
      onRestoreComplete?.();
    };

    const restore = (): boolean => {
      const target = restoreTarget != null ? findMessageElement(vp, restoreTarget) : null;
      if (!target) return false;
      // Scroll so the last read message's bottom edge stays visible just
      // inside the top of the viewport: the unread content reads from the
      // top, with a sliver of the read anchor above it for context. A restore
      // target is an anchor, not an exact pixel location: the local client
      // may pick this offset, but it must never be persisted. When the target
      // is the newest message (the session is fully read), its bottom edge
      // cannot fit above the bottom of the content, so the scroll clamps to
      // the bottom naturally — no explicit branch is needed.
      const top =
        target.getBoundingClientRect().bottom -
        vp.getBoundingClientRect().top +
        vp.scrollTop -
        RESTORE_MARGIN;
      vp.scrollTo({ top: Math.max(0, top) });
      finish(false);
      return true;
    };

    if (!restoring) {
      // First run without a saved anchor: pin to the bottom as before. Later
      // re-runs (a changed cursor after revalidation) must never re-pin over
      // the user's restored position.
      if (!restoredOnceRef.current) finish(true);
    }

    // Content can render asynchronously (markdown, images, fonts), so poll
    // for the anchor until it exists; fall back to the bottom when the saved
    // key is absent (compacted away or removed) after a grace period.
    if (restoring && restoreDeadlineRef.current === 0) {
      restoreDeadlineRef.current = Date.now() + RESTORE_GRACE_MS;
    }
    const restoreTimer = restoring
      ? window.setInterval(() => {
          if (restore() || Date.now() > restoreDeadlineRef.current) {
            clearInterval(restoreTimer);
            if (!restoredOnceRef.current) finish(true);
          }
        }, RESTORE_POLL_MS)
      : undefined;

    // Re-pin whenever content or the viewport itself resizes, but only once
    // restoration has finished and while the user is still following.
    const resizeObserver = new ResizeObserver(() => {
      if (restoredOnceRef.current && followingRef.current) {
        scrollToBottom();
      }
    });
    resizeObserver.observe(vp);
    // Observe the content wrapper too so that height changes of children
    // (markdown blocks, code fences, images) are caught.
    const content = vp.firstElementChild;
    if (content) {
      resizeObserver.observe(content);
    }

    return () => {
      if (restoreTimer != null) clearInterval(restoreTimer);
      resizeObserver.disconnect();
    };
  }, [autoScroll, restoreTarget, scrollToBottom, atBottom, onRestoreComplete]);

  return (
    <Primitive.Root ref={rootRef} scrollHideDelay={1500} className={cx(rootStyle, className)}>
      <Primitive.Viewport
        {...viewportProps}
        className={cx(viewportStyle, viewportClassName)}
        onScroll={handleScroll}
        ref={setViewportRef}
      >
        {disableHorizontalScroll ? (
          // Radix wraps the viewport's content in a `display: table` box that
          // grows to the widest unbreakable child (capped by `max-width`).
          // Size confinement in the inline axis makes this wrapper's content
          // stop feeding that intrinsic width, so the pane always lays out at
          // its own width instead of widening and being clipped.
          <div className={confinementStyle}>{children}</div>
        ) : (
          children
        )}
      </Primitive.Viewport>
      <Primitive.Scrollbar
        orientation="vertical"
        className={scrollbar({ orientation: "vertical" })}
      >
        <Primitive.Thumb className={thumbStyle} />
      </Primitive.Scrollbar>
      {!disableHorizontalScroll && (
        <Primitive.Scrollbar
          orientation="horizontal"
          className={scrollbar({ orientation: "horizontal" })}
        >
          <Primitive.Thumb className={thumbStyle} />
        </Primitive.Scrollbar>
      )}
      <Primitive.Corner className={cornerStyle} />
    </Primitive.Root>
  );
}
