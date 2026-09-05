import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ContextUsageIndicator } from "./context-usage";

describe("ContextUsageIndicator", () => {
  it("renders the context percentage as a meter", async () => {
    const screen = await render(
      <ContextUsageIndicator usage={{ tokens: 45_000, contextWindow: 100_000, percent: 45 }} />,
    );

    const meter = screen.getByRole("meter", { name: "Context usage" });
    await expect.element(meter).toHaveAttribute("aria-valuenow", "45");
    await expect.element(meter).toHaveAttribute("aria-valuemin", "0");
    await expect.element(meter).toHaveAttribute("aria-valuemax", "100");
    await expect.element(meter).toHaveTextContent("45%");
  });

  it("renders an indeterminate state when the token count is unknown", async () => {
    const screen = await render(
      <ContextUsageIndicator usage={{ tokens: null, contextWindow: 100_000, percent: null }} />,
    );

    const indicator = screen.getByRole("img", { name: "Context usage unknown" });
    await expect.element(indicator).not.toHaveAttribute("aria-valuenow");
    await expect.element(indicator).toHaveTextContent("?");
  });
});
