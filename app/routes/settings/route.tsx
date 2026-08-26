import { Layers, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { css } from "styled-system/css";

import { useTheme, type Theme } from "~/contexts/theme";

import type { Route } from "./+types/route";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Settings" }];
}

const toggleGroupStyle = css({
  display: "inline-flex",
  alignItems: "stretch",
  borderRadius: "lg",
  borderWidth: "1px",
  borderColor: "border",
  overflow: "hidden",
});

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const topbarStyle = css({
  backgroundColor: "bg.panel",
  borderBottomWidth: "1px",
  borderColor: "border.panel",
});

const cardStyle = css({
  backgroundColor: "bg.panel",
  borderWidth: "1px",
  borderColor: "border.panel",
  borderRadius: "xl",
  padding: "4",
});

const toggleItemStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "1.5",
  paddingInline: "3",
  paddingBlock: "2",
  textStyle: "sm",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  borderRightWidth: "1px",
  borderRightColor: "border",
  _last: { borderRightWidth: 0 },
  backgroundColor: "bg.subtle",
  color: "fg.secondary",
  _hover: { backgroundColor: { base: "gray.100", _dark: "gray.700" } },
  "&[data-state=on]": {
    backgroundColor: { base: "blue.50", _dark: "blue.900/40" },
    color: { base: "blue.700", _dark: "blue.400" },
  },
});

export default function Settings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={css({ height: "full", display: "flex", flexDirection: "column" })}>
      {/* Top bar */}
      <div className={topbarStyle}>
        <div
          className={css({
            maxWidth: "3xl",
            marginInline: "auto",
            paddingInline: "4",
            height: "14",
            display: "flex",
            alignItems: "center",
            gap: "3",
          })}
        >
          <Layers className={css({ width: "5", height: "5", color: "blue.500" })} />
          <span className={css({ fontWeight: "semibold", color: "fg.primary" })}>Settings</span>
        </div>
      </div>

      <div
        className={css({
          flex: "1",
          maxWidth: "3xl",
          marginInline: "auto",
          width: "full",
          padding: "6",
        })}
      >
        <div className={cardStyle}>
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            })}
          >
            <h2 className={css({ textStyle: "sm", fontWeight: "medium", color: "fg.secondary" })}>
              Theme
            </h2>
            <ToggleGroup.Root
              type="single"
              value={theme}
              onValueChange={(value) => {
                if (value) setTheme(value as Theme);
              }}
              aria-label="Theme"
              className={toggleGroupStyle}
            >
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <ToggleGroup.Item key={value} value={value} className={toggleItemStyle}>
                  <Icon className={css({ width: "4", height: "4" })} />
                  {label}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          </div>
        </div>
      </div>
    </div>
  );
}
