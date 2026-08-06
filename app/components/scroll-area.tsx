import { ScrollArea as Primitive } from "radix-ui";
import { useCallback, useEffect, useRef, type UIEvent } from "react";

export function ScrollArea({
  autoScroll,
  autoScrollOffset = 50,
  className,
  viewportClassName,
  onScroll,
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
  }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Whether we are currently following the bottom of the content.
  const followingRef = useRef(!!autoScroll);
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
    // Pin to the bottom immediately; content that has not been laid out yet
    // (async markdown, fonts, images) re-pins via the ResizeObserver below,
    // so the initial load always ends at the bottom.
    scrollToBottom();
    // Record the pinned position right away: the browser's own scroll event
    // for the pin may be delayed or coalesced, and direction detection below
    // needs an accurate previous position to tell "scrolled up" from a stale
    // first event.
    prevScrollTopRef.current = vp.scrollTop;

    const resizeObserver = new ResizeObserver(() => {
      // Re-pin whenever content or the viewport itself resizes, but only while
      // the user is still following.
      if (followingRef.current) {
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

    return () => resizeObserver.disconnect();
  }, [autoScroll, scrollToBottom]);

  return (
    <Primitive.Root
      ref={rootRef}
      scrollHideDelay={1500}
      className={`flex-1 min-h-0 min-w-0 size-full overflow-hidden${className ? ` ${className}` : ""}`}
    >
      <Primitive.Viewport
        {...viewportProps}
        className={`size-full min-h-0 min-w-0${viewportClassName ? ` ${viewportClassName}` : ""}`}
        onScroll={handleScroll}
        ref={setViewportRef}
      />
      <Primitive.Scrollbar
        orientation="vertical"
        className="flex flex-row select-none touch-none p-0.5 transition-colors duration-150 ease-out w-2"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full transition-opacity opacity-30 hover:opacity-50 bg-black dark:bg-white" />
      </Primitive.Scrollbar>
      <Primitive.Scrollbar
        orientation="horizontal"
        className="flex flex-col select-none touch-none p-0.5 transition-colors duration-150 ease-out h-2"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full transition-opacity opacity-30 hover:opacity-50 bg-black dark:bg-white" />
      </Primitive.Scrollbar>
      <Primitive.Corner className="bg-gray-100 dark:bg-gray-800" />
    </Primitive.Root>
  );
}
