import { Layers, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { css } from "styled-system/css";
import { flex } from "styled-system/patterns";
import { card, topbar } from "styled-system/recipes";

import { useTheme, type Theme } from "~/contexts/theme";

import type { Route } from "./+types/route";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Settings" }];
}

const topbarClasses = topbar();

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

const cardStyle = card({ surface: "panel", padded: true });

const toggleItemStyle = flex({
  align: "center",
  gap: "1.5",
  paddingInline: "3",
  paddingBlock: "2",
  textStyle: "sm",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  borderRightWidth: "1px",
  borderRightColor: "border",
  _last: { borderRightWidth: 0 },
  backgroundColor: "subtle.bg",
  color: "secondary.fg",
  _hover: { backgroundColor: "secondary.wash" },
  "&[data-state=on]": {
    backgroundColor: "accent.wash",
    color: "accent.fg",
  },
});

export default function Settings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className={flex({ height: "full", direction: "column" })}>
      {/* Top bar */}
      <div className={topbarClasses.root}>
        <div className={topbarClasses.inner}>
          <Layers className={css({ width: "5", height: "5", color: "info" })} />
          <span className={css({ fontWeight: "semibold", color: "primary.fg" })}>Settings</span>
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
            className={flex({
              align: "center",
              justify: "space-between",
            })}
          >
            <h2 className={css({ textStyle: "sm", fontWeight: "medium", color: "secondary.fg" })}>
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
