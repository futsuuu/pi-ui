import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ThemeProvider } from "~/contexts/theme";

import Settings from "./route";

/** Stub the OS preference so a "system" theme resolves deterministically. */
function installSystemDark(initialMatches: boolean) {
  const mql = {
    media: "(prefers-color-scheme: dark)",
    matches: initialMatches,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
}

function renderSettings() {
  return render(
    <ThemeProvider>
      <Settings />
    </ThemeProvider>,
  );
}

describe("Settings page", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    vi.unstubAllGlobals();
    // Each test renders its own tree; drop the previous test's containers so
    // Testing Library queries stay single-match.
    document.body.innerHTML = "";
  });

  it("offers System, Light, and Dark theme choices", async () => {
    installSystemDark(false);
    const screen = await renderSettings();
    await expect.element(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
    await expect.element(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    await expect.element(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
  });

  it("defaults to System", async () => {
    installSystemDark(true);
    const screen = await renderSettings();
    await expect
      .element(screen.getByRole("radio", { name: "System" }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("switches the theme on click and persists it", async () => {
    installSystemDark(false);
    const screen = await renderSettings();

    await screen.getByRole("radio", { name: "Dark" }).click();
    expect(localStorage.getItem("theme")).toBe("dark");
    await expect
      .element(screen.getByRole("radio", { name: "Dark" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(screen.getByRole("radio", { name: "System" }))
      .toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.className).toBe("dark");

    await screen.getByRole("radio", { name: "Light" }).click();
    expect(localStorage.getItem("theme")).toBe("light");
    await expect
      .element(screen.getByRole("radio", { name: "Light" }))
      .toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.className).toBe("");
  });
});
