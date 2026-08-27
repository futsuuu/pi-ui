import { Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Children, type ReactNode } from "react";
import { css, cx } from "styled-system/css";
import { flex } from "styled-system/patterns";

const triggerStyle = css({
  borderRadius: "lg",
  color: "subtle.fg",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "subtle.wash",
    color: "secondary.fg",
  },
});

const contentStyle = css({
  zIndex: 50,
  minWidth: "160px",
  backgroundColor: "card.bg",
  borderWidth: "1px",
  borderColor: "border",
  borderRadius: "lg",
  boxShadow: "lg",
  padding: "1",
});

const deleteItemStyle = flex({
  align: "center",
  gap: "2",
  paddingInline: "2.5",
  paddingBlock: "1.5",
  borderRadius: "md",
  textStyle: "sm",
  color: "danger",
  outline: "none",
  cursor: "pointer",
  _highlighted: {
    backgroundColor: "danger.wash",
    color: "danger.strong",
  },
  _disabled: {
    opacity: 0.4,
    cursor: "not-allowed",
  },
});

/**
 * Shared frame of a row action dropdown menu: trigger button, portal, and
 * content box. Callers pass in the trigger icon and any positioning styles;
 * the menu items (e.g. {@link DeleteMenuItem}) are supplied as children.
 */
export function ActionsMenu({
  ariaLabel,
  trigger,
  triggerClassName,
  align = "end",
  sideOffset = 4,
  children,
}: {
  /** Accessible name of the trigger button. */
  ariaLabel: string;
  /** Trigger button contents (e.g. a MoreVertical icon). */
  trigger: ReactNode;
  /** Positioning / padding styles for the trigger button (a `css()` result). */
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  children?: ReactNode;
}) {
  // A row can show the trigger even when it has no actions (e.g. the main
  // worktree is not deletable); without items there is no menu to open.
  const hasItems = Children.count(children) > 0;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={ariaLabel} className={cx(triggerStyle, triggerClassName)}>
          {trigger}
        </button>
      </DropdownMenu.Trigger>
      {hasItems && (
        <DropdownMenu.Portal>
          <DropdownMenu.Content align={align} sideOffset={sideOffset} className={contentStyle}>
            {children}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      )}
    </DropdownMenu.Root>
  );
}

/** Standard destructive "delete" menu item used by row action menus. */
export function DeleteMenuItem({
  onSelect,
  label,
  disabled = false,
}: {
  onSelect: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu.Item onSelect={onSelect} disabled={disabled} className={deleteItemStyle}>
      <Trash2 className={css({ width: "4", height: "4" })} />
      {label}
    </DropdownMenu.Item>
  );
}
