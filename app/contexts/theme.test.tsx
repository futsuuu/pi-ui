import { css } from "styled-system/css";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ThemeProvider, ThemeScript, useTheme } from "./theme";

/** Stubs matchMedia and exposes a hook to flip the OS preference. */
function installSystemDark(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  let matches = initialMatches;
  const mql = {
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, cb: () => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_: string, cb: () => void) => {
      listeners.delete(cb);
    },
    get matches() {
      return matches;
    },
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return {
    setMatches(value: boolean) {
      matches = value;
      for (const cb of listeners) cb();
    },
  };
}

/** Exposes the context state and buttons that call setTheme. */
// The buttons carry padding so they have a nonzero click target: the test
// font renders at width 0, which would otherwise make Playwright's
// locator.click() treat the text buttons as invisible.
function ThemeHarness() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button className={harnessButton} onClick={() => setTheme("system")}>
        set system
      </button>
      <button className={harnessButton} onClick={() => setTheme("light")}>
        set light
      </button>
      <button className={harnessButton} onClick={() => setTheme("dark")}>
        set dark
      </button>
    </div>
  );
}

const harnessButton = css({ paddingInline: "2", paddingBlock: "1" });

async function renderProvider(initialSystemDark = false) {
  const system = installSystemDark(initialSystemDark);
  const screen = await render(
    <ThemeProvider>
      <ThemeHarness />
    </ThemeProvider>,
  );
  return { screen, system };
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    vi.unstubAllGlobals();
    // Each test renders its own tree; drop the previous test's containers so
    // Testing Library queries stay single-match.
    document.body.innerHTML = "";
  });

  it("defaults to system and resolves against the OS preference", async () => {
    const { screen } = await renderProvider(true);
    await expect.element(screen.getByTestId("theme")).toHaveTextContent("system");
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.className).toBe("dark");
  });

  it("follows OS changes while the theme is system", async () => {
    const { screen, system } = await renderProvider(false);
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.className).toBe("");

    system.setMatches(true);
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.className).toBe("dark");

    system.setMatches(false);
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.className).toBe("");
  });

  it("treats unknown saved values as system", async () => {
    localStorage.setItem("theme", "blue");
    const { screen, system } = await renderProvider(false);
    await expect.element(screen.getByTestId("theme")).toHaveTextContent("system");
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("light");

    // Still follows the OS, proving it resolved as system rather than light.
    system.setMatches(true);
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("restores a saved theme on mount", async () => {
    localStorage.setItem("theme", "dark");
    const { screen } = await renderProvider(false);
    await expect.element(screen.getByTestId("theme")).toHaveTextContent("dark");
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement.className).toBe("dark");
  });

  it("applies and persists a chosen theme", async () => {
    const { screen } = await renderProvider(false);
    await screen.getByRole("button", { name: "set dark" }).click();
    expect(localStorage.getItem("theme")).toBe("dark");
    await expect.element(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(document.documentElement.className).toBe("dark");

    await screen.getByRole("button", { name: "set light" }).click();
    expect(localStorage.getItem("theme")).toBe("light");
    await expect.element(screen.getByTestId("theme")).toHaveTextContent("light");
    expect(document.documentElement.className).toBe("");
  });

  it("switching back to system resumes following the OS", async () => {
    const { screen, system } = await renderProvider(false);
    await screen.getByRole("button", { name: "set dark" }).click();
    expect(localStorage.getItem("theme")).toBe("dark");

    system.setMatches(true);
    // Explicit dark: unaffected by the OS change.
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("dark");

    await screen.getByRole("button", { name: "set system" }).click();
    expect(localStorage.getItem("theme")).toBe("system");
    await expect.element(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });
});

describe("ThemeScript", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  /** Renders ThemeScript and returns a runner for its generated script. */
  async function renderScript() {
    const screen = await render(<ThemeScript />);
    // Restrict to the render container: the page carries vitest's own scripts.
    const script = screen.container.querySelector("script");
    expect(script).not.toBeNull();
    return () => {
      const runner = document.createElement("script");
      runner.textContent = script!.textContent ?? "";
      document.body.appendChild(runner);
    };
  }

  it("treats unknown saved values as system", async () => {
    const system = installSystemDark(false);
    localStorage.setItem("theme", "blue");
    const run = await renderScript();

    run();
    expect(document.documentElement.className).toBe("");

    document.documentElement.className = "";
    system.setMatches(true);
    run();
    expect(document.documentElement.className).toBe("dark");
  });

  it("honors explicit light/dark over the OS preference", async () => {
    installSystemDark(true);
    localStorage.setItem("theme", "light");
    const run = await renderScript();

    run();
    expect(document.documentElement.className).toBe("");

    localStorage.setItem("theme", "dark");
    document.documentElement.className = "";
    run();
    expect(document.documentElement.className).toBe("dark");
  });
});
