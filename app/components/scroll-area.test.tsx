import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ScrollArea } from "./scroll-area";

const LINE_HEIGHT = 40;

interface HarnessApi {
  /** The scrollable viewport element (exposed through the forwarded ref). */
  viewport: () => HTMLDivElement | null;
  /** Append `count` more lines to the content. */
  addLines: (count: number) => void;
  /** Change the height of the surrounding box (simulates window/viewport resize). */
  setContainerHeight: (height: number) => void;
  /** Move the viewport to an absolute scrollTop, simulating a user gesture. */
  scrollTo: (top: number) => void;
  /** Fire a `scroll` event so the component observes the current scroll position. */
  dispatchScroll: () => void;
  /** Distance in px between the current scroll position and the bottom. */
  distanceFromBottom: () => number;
  /** Number of times onRestoreComplete fired. */
  restoreCount: () => number;
}

function Harness({
  api,
  autoScroll,
  autoScrollOffset = 50,
  initialLines = 20,
  startHeight = 300,
  mountKey,
  restoreTarget,
  disableHorizontalScroll,
}: {
  api: HarnessApi;
  /** `undefined`/`false` disables auto-scroll. */
  autoScroll?: boolean;
  autoScrollOffset?: number;
  initialLines?: number;
  startHeight?: number;
  /** Changing this remounts the ScrollArea (used to simulate session switches). */
  mountKey?: string;
  /** Shared display anchor to restore on mount. */
  restoreTarget?: string | null;
  /** Renders no horizontal scrollbar. */
  disableHorizontalScroll?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState(initialLines);
  const [containerHeight, setContainerHeight] = useState(startHeight);
  const [restoreCount, setRestoreCount] = useState(0);
  const apiRef = useRef(api);

  useLayoutEffect(() => {
    const target = apiRef.current;
    target.viewport = () => viewportRef.current;
    target.addLines = (count) => setLines((current) => current + count);
    target.setContainerHeight = setContainerHeight;
    target.scrollTo = (top) => {
      const vp = viewportRef.current;
      if (!vp) return;
      // Wheel is the first event of a user scroll gesture (before the scroll
      // event itself); the component uses it to attribute the scroll to the
      // user rather than to layout changes.
      const deltaY = top < vp.scrollTop ? -100 : 100;
      vp.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true }));
      vp.scrollTop = top;
    };
    target.dispatchScroll = () => {
      viewportRef.current?.dispatchEvent(new Event("scroll", { bubbles: true }));
    };
    target.distanceFromBottom = () => {
      const vp = viewportRef.current;
      if (!vp) return Infinity;
      return vp.scrollHeight - vp.scrollTop - vp.clientHeight;
    };
    target.restoreCount = () => restoreCount;
  }, [restoreCount]);

  return (
    <div style={{ height: containerHeight }}>
      <ScrollArea
        ref={viewportRef}
        key={mountKey}
        autoScroll={autoScroll}
        autoScrollOffset={autoScrollOffset}
        restoreTarget={restoreTarget}
        onRestoreComplete={() => setRestoreCount((count) => count + 1)}
        disableHorizontalScroll={disableHorizontalScroll}
      >
        <div data-testid="content">
          {Array.from({ length: lines }, (_, index) => (
            <div key={index} data-message-key={`user:${index}`} style={{ height: LINE_HEIGHT }}>
              line {index}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Wait until the viewport has scrolled to the bottom. */
async function expectPinned(api: HarnessApi, timeout = 2000) {
  await expect.poll(() => api.distanceFromBottom(), { timeout }).toBeLessThanOrEqual(1);
}

describe("ScrollArea horizontal overflow", () => {
  it("keeps horizontal scrolling enabled by default", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} />);

    expect(getComputedStyle(api.viewport()!).overflowX).toBe("scroll");
  });

  it("clips horizontal overflow when disableHorizontalScroll is set", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} disableHorizontalScroll />);

    expect(getComputedStyle(api.viewport()!).overflowX).toBe("hidden");
  });

  it("keeps the pane from widening with wide children when disableHorizontalScroll is set", async () => {
    let vp: HTMLDivElement | null = null;
    await render(
      <div style={{ width: 400 }}>
        <ScrollArea
          disableHorizontalScroll
          ref={(node) => {
            vp = node;
          }}
        >
          <div style={{ whiteSpace: "nowrap", width: 2000 }}>wide</div>
        </ScrollArea>
      </div>,
    );

    // The Radix content wrapper (the viewport's first child) must stay at
    // the pane width instead of growing to the wide child's width.
    expect((vp!.firstElementChild as HTMLElement).clientWidth).toBe(400);
  });

  it("keeps content widening when horizontal scrolling is enabled", async () => {
    let vp: HTMLDivElement | null = null;
    await render(
      <div style={{ width: 400 }}>
        <ScrollArea
          ref={(node) => {
            vp = node;
          }}
        >
          <div style={{ whiteSpace: "nowrap", width: 2000 }}>wide</div>
        </ScrollArea>
      </div>,
    );

    expect((vp!.firstElementChild as HTMLElement).clientWidth).toBeGreaterThan(400);
  });
});

describe("ScrollArea auto-scroll", () => {
  it("pins to the bottom on mount when autoScroll is enabled", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll />);
    await expectPinned(api);
  });

  it("keeps following as content grows", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll />);
    await expectPinned(api);

    api.addLines(10);
    await expectPinned(api);
  });

  it("does not scroll by default (autoScroll off)", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} />);

    await expect.poll(() => api.viewport()?.scrollTop ?? -1, { timeout: 500 }).toBe(0);

    api.addLines(10);
    // Wait a couple of frames; content grew but no follow should have happened.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.viewport()?.scrollTop).toBe(0);
  });

  it("stops following when the user scrolls up, and re-enables at the bottom", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll />);
    await expectPinned(api);

    // Simulate scrolling up away from the bottom.
    const vp = api.viewport()!;
    const upTop = Math.max(0, vp.scrollTop - 120);
    api.scrollTo(upTop);
    api.dispatchScroll();

    // Growing content must not yank the user back down.
    api.addLines(10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.viewport()?.scrollTop).toBe(upTop);

    // Scrolling back to the bottom re-enables following, even within the offset.
    const vp2 = api.viewport()!;
    api.scrollTo(vp2.scrollHeight - vp2.clientHeight - 20);
    api.dispatchScroll();

    api.addLines(10);
    await expectPinned(api);
  });

  it("stays pinned through sudden viewport height changes", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll />);
    await expectPinned(api);

    api.setContainerHeight(150); // half the original height
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expectPinned(api);

    api.setContainerHeight(500); // grow it again
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expectPinned(api);
  });

  it("still reaches the bottom on initial load when content renders asynchronously", async () => {
    const api = {} as HarnessApi;
    // Start empty (content below the fold hasn't been measured/revealed yet,
    // like a loading markdown block) and load more content shortly after.
    await render(<Harness api={api} initialLines={0} autoScroll />);

    await new Promise((resolve) => setTimeout(resolve, 50));
    api.addLines(30);

    await expectPinned(api);
  });

  it("re-pins and resumes following after a remount (session switch)", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} mountKey="session-a" autoScroll />);
    await expectPinned(api);

    // User scrolled up and stopped following, as in the previous session.
    const vp = api.viewport()!;
    api.scrollTo(Math.max(0, vp.scrollTop - 120));
    api.dispatchScroll();

    // Simulate navigating to a new session: the component is re-created, so
    // auto-scroll state must start over (pinned + following).
    await render(<Harness api={api} mountKey="session-b" autoScroll />);
    await expectPinned(api);

    api.addLines(10);
    await expectPinned(api);
  });
});

describe("ScrollArea anchor restoration", () => {
  // 20 lines x 40px = 800px of content in a 300px viewport.
  const CONTENT_HEIGHT = 800;
  const VIEWPORT_HEIGHT = 300;
  const MAX_SCROLL = CONTENT_HEIGHT - VIEWPORT_HEIGHT; // 500
  const LINE = 40;

  it("restores an existing anchor with its bottom edge visible at the top", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll restoreTarget="user:10" />);

    // The saved (read) message's bottom edge sits just inside the top of the
    // viewport (10 lines x 40px + 40px height - 48px margin), so the unread
    // content reads from the top with a sliver of the anchor above it.
    await expect
      .poll(() => api.viewport()?.scrollTop, { timeout: 2000 })
      .toBe(10 * LINE + LINE - 48);
    await expect.poll(() => api.restoreCount(), { timeout: 2000 }).toBe(1);
  });

  it("does not jump to the bottom after restoration while content grows", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll restoreTarget="user:10" />);
    await expect.poll(() => api.viewport()?.scrollTop, { timeout: 2000 }).toBe(392);

    // The anchor sits in the middle of the conversation: growing content may
    // not yank the viewport to the bottom (not following).
    api.addLines(10);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.viewport()?.scrollTop).toBe(392);
  });

  it("falls back to the bottom when the saved anchor is missing", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll restoreTarget="user:999" />);

    // The anchor never renders: after the polling grace period the viewport
    // falls back to the newest content.
    await expectPinned(api, 4000);
    await expect.poll(() => api.restoreCount(), { timeout: 6000 }).toBe(1);
  });

  it("restores against the scroll area's own top, not the page top", async () => {
    const api = {} as HarnessApi;
    // A fixed header above the scroll area: restoration must anchor to the
    // scroll area's top edge, so the read message's bottom edge ends up
    // 48px below THAT edge — not 48px below the page top (which would hide
    // the message behind the header).
    await render(
      <div>
        <div style={{ height: 100 }}>header</div>
        <Harness api={api} autoScroll restoreTarget="user:10" />
      </div>,
    );
    // The content-relative scroll position is unaffected by the header.
    await expect.poll(() => api.viewport()?.scrollTop, { timeout: 2000 }).toBe(392);
    await expect
      .poll(
        () => {
          const vp = api.viewport();
          const target = vp?.querySelector('[data-message-key="user:10"]');
          if (!vp || !target) return -1;
          // Distance of the anchor's bottom edge below the scroll area's top.
          return Math.round(target.getBoundingClientRect().bottom - vp.getBoundingClientRect().top);
        },
        { timeout: 2000 },
      )
      .toBe(48);
  });

  it("clamps to the bottom when the anchor is the newest message", async () => {
    const api = {} as HarnessApi;
    await render(<Harness api={api} autoScroll restoreTarget="user:19" />);

    // The last line's bottom edge cannot be placed 48px above the bottom of
    // the content, so the viewport clamps to the bottom. This is what makes
    // a fully-read session (whose cursor is the latest message) restore to
    // the bottom without an explicit read-state branch.
    await expectPinned(api);
    await expect.poll(() => api.viewport()?.scrollTop, { timeout: 2000 }).toBe(MAX_SCROLL);

    // At the bottom, following resumes for streamed content.
    api.addLines(10);
    await expectPinned(api);
  });

  it("restoring a target is a one-shot per mount (revalidation does not re-pin)", async () => {
    const api = {} as HarnessApi;
    function RevalidatingHarness() {
      const [target, setTarget] = useState<string | null>("user:10");
      useEffect(() => {
        // Simulate a revalidation delivering a newer cursor value.
        const timer = setTimeout(() => setTarget("user:12"), 200);
        return () => clearTimeout(timer);
      }, []);
      return <Harness api={api} autoScroll restoreTarget={target} />;
    }
    await render(<RevalidatingHarness />);

    // The mount restored user:10 (392px) and completed exactly once.
    await expect.poll(() => api.viewport()?.scrollTop, { timeout: 2000 }).toBe(392);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(api.restoreCount()).toBe(1);
    // The cursor change after revalidation must not re-scroll over the
    // user's restored position.
    expect(api.viewport()?.scrollTop).toBe(392);
  });
});
