import { Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { Children, type ReactNode } from "react";

/**
 * Shared frame of a row action dropdown menu: trigger button, portal, and
 * content box. Callers pass in the trigger icon and any positioning classes;
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
  /** Positioning / padding classes for the trigger button. */
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
        <button
          type="button"
          aria-label={ariaLabel}
          className={`rounded-lg text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors${triggerClassName ? ` ${triggerClassName}` : ""}`}
        >
          {trigger}
        </button>
      </DropdownMenu.Trigger>
      {hasItems && (
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align={align}
            sideOffset={sideOffset}
            className="z-50 min-w-[160px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-1"
          >
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
    <DropdownMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-red-600 dark:text-red-400 outline-none cursor-pointer data-[highlighted]:bg-red-50 dark:data-[highlighted]:bg-red-900/30 data-[highlighted]:text-red-700 dark:data-[highlighted]:text-red-300 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed"
    >
      <Trash2 className="w-4 h-4" />
      {label}
    </DropdownMenu.Item>
  );
}
