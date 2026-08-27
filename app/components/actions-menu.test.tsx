import { css } from "styled-system/css";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { ActionsMenu, DeleteMenuItem } from "./actions-menu";

const triggerPadding = css({ padding: "2", margin: "-1" });

describe("ActionsMenu", () => {
  it("renders a trigger button with the given accessible name and content", async () => {
    const screen = await render(
      <ActionsMenu ariaLabel="Session actions" trigger={<span>menu</span>}>
        <DeleteMenuItem onSelect={() => {}} label="Delete Session" />
      </ActionsMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Session actions" });
    await expect.element(trigger).toBeInTheDocument();
    await expect.element(trigger).toHaveTextContent("menu");
  });

  it("merges positioning styles into the trigger button", async () => {
    const screen = await render(
      <ActionsMenu
        ariaLabel="Worktree actions"
        trigger={<span>menu</span>}
        triggerClassName={css({ padding: "2", margin: "-1" })}
      >
        <DeleteMenuItem onSelect={() => {}} label="Delete Worktree" />
      </ActionsMenu>,
    );

    const trigger = screen.getByRole("button", { name: "Worktree actions" });
    await expect.element(trigger).toBeInTheDocument();
    const style = getComputedStyle(trigger.element());
    expect(style.paddingLeft).toBe("8px");
    expect(style.marginLeft).toBe("-4px");
  });

  it("opens the menu on click and renders the delete item", async () => {
    const screen = await render(
      <ActionsMenu
        ariaLabel="Worktree actions"
        trigger={<span>menu</span>}
        triggerClassName={triggerPadding}
      >
        <DeleteMenuItem onSelect={() => {}} label="Delete Worktree" />
      </ActionsMenu>,
    );

    await screen.getByRole("button", { name: "Worktree actions" }).click();
    // Radix portals the menu content to the end of <body>, outside the component container.
    const item = screen.getByText("Delete Worktree", { exact: true });
    await expect.element(item).toBeInTheDocument();
  });

  it("does not open a menu when it has no items", async () => {
    const screen = await render(
      <ActionsMenu
        ariaLabel="Worktree actions"
        trigger={<span>menu</span>}
        triggerClassName={triggerPadding}
      />,
    );

    await screen.getByRole("button", { name: "Worktree actions" }).click();
    // No items: nothing is portaled, so no menu appears.
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("fires onSelect when the delete item is chosen", async () => {
    let calls = 0;
    const screen = await render(
      <ActionsMenu
        ariaLabel="Worktree actions"
        trigger={<span>menu</span>}
        triggerClassName={triggerPadding}
      >
        <DeleteMenuItem
          onSelect={() => {
            calls++;
          }}
          label="Delete Worktree"
        />
      </ActionsMenu>,
    );

    await screen.getByRole("button", { name: "Worktree actions" }).click();
    await screen.getByText("Delete Worktree", { exact: true }).click();
    expect(calls).toBe(1);
  });

  it("renders a disabled delete item that does not fire onSelect", async () => {
    let calls = 0;
    const screen = await render(
      <ActionsMenu
        ariaLabel="Worktree actions"
        trigger={<span>menu</span>}
        triggerClassName={triggerPadding}
      >
        <DeleteMenuItem
          onSelect={() => {
            calls++;
          }}
          label="Delete Worktree"
          disabled
        />
      </ActionsMenu>,
    );

    await screen.getByRole("button", { name: "Worktree actions" }).click();
    const item = screen.getByText("Delete Worktree", { exact: true });
    await expect.element(item).toHaveAttribute("data-disabled");
    // Playwright refuses to click the aria-disabled item, so force it: Radix
    // still must not fire onSelect for a disabled item.
    await item.click({ force: true });
    expect(calls).toBe(0);
  });
});
