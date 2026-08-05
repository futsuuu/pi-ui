import { useLayoutEffect, useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ScrollArea } from "./scroll-area";

const LINE_HEIGHT = 40;

/** A fixed-height line so content height is predictable and measurable. */
function Line({ index }: { index: number }) {
  return <div style={{ height: LINE_HEIGHT }}>line {index}</div>;
}

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
}

function Harness({
  api,
  autoScroll,
  autoScrollOffset = 50,
  initialLines = 20,
  startHeight = 300,
  mountKey,
}: {
  api: HarnessApi;
  /** `undefined`/`false` disables auto-scroll. */
  autoScroll?: boolean;
  autoScrollOffset?: number;
  initialLines?: number;
  startHeight?: number;
  /** Changing this remounts the ScrollArea (used to simulate session switches). */
  mountKey?: string;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [lines, setLines] = useState(initialLines);
  const [containerHeight, setContainerHeight] = useState(startHeight);

  useLayoutEffect(() => {
    api.viewport = () => viewportRef.current;
    api.addLines = (count) => setLines((current) => current + count);
    api.setContainerHeight = setContainerHeight;
    api.scrollTo = (top) => {
      const vp = viewportRef.current;
      if (!vp) return;
      // Wheel is the first event of a user scroll gesture (before the scroll
      // event itself); the component uses it to attribute the scroll to the
      // user rather than to layout changes.
      const deltaY = top < vp.scrollTop ? -100 : 100;
      vp.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true }));
      vp.scrollTop = top;
    };
    api.dispatchScroll = () => {
      viewportRef.current?.dispatchEvent(new Event("scroll", { bubbles: true }));
    };
    api.distanceFromBottom = () => {
      const vp = viewportRef.current;
      if (!vp) return Infinity;
      return vp.scrollHeight - vp.scrollTop - vp.clientHeight;
    };
  });

  return (
    <div style={{ height: containerHeight }}>
      <ScrollArea
        ref={viewportRef}
        key={mountKey}
        autoScroll={autoScroll}
        autoScrollOffset={autoScrollOffset}
      >
        <div data-testid="content">
          {Array.from({ length: lines }, (_, index) => (
            <Line key={index} index={index} />
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
