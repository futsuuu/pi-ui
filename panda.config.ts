import { defineConfig, defineRecipe, defineSlotRecipe } from "@pandacss/dev";

import { colors, semantic } from "./app/theme/colors";

const iconButton = defineRecipe({
  className: "iconButton",
  base: {
    padding: "2",
    borderRadius: "lg",
    color: "muted.fg",
    transitionProperty: "colors",
    transitionDuration: "150ms",
    _hover: { backgroundColor: "muted.wash" },
  },
  variants: {
    emphasis: {
      onHover: {
        _hover: { color: "primary.fg", backgroundColor: "muted.wash" },
      },
    },
  },
});

const button = defineRecipe({
  className: "button",
  base: {
    borderRadius: "lg",
    color: "inverse.fg",
    transitionProperty: "colors",
    transitionDuration: "150ms",
  },
  variants: {
    color: {
      primary: {
        backgroundColor: "action",
        _hover: { backgroundColor: "action.hover" },
      },
      danger: {
        backgroundColor: "danger.solid",
        _hover: { backgroundColor: "danger.solidHover" },
      },
    },
  },
  defaultVariants: { color: "primary" },
});

const card = defineRecipe({
  className: "card",
  base: { borderWidth: "1px", borderRadius: "xl" },
  variants: {
    surface: {
      panel: { backgroundColor: "panel.bg", borderColor: "panel.border" },
      elevated: { backgroundColor: "card.bg", borderColor: "border", boxShadow: "overlay" },
    },
    padded: {
      true: { padding: "4" },
      false: {},
    },
  },
  defaultVariants: { surface: "panel" },
});

const topbar = defineSlotRecipe({
  className: "topbar",
  slots: ["root", "inner"],
  base: {
    root: {
      backgroundColor: "panel.bg",
      borderBottomWidth: "1px",
      borderColor: "panel.border",
    },
    inner: {
      maxWidth: "3xl",
      marginInline: "auto",
      paddingInline: "4",
      height: "14",
      display: "flex",
      alignItems: "center",
      gap: "3",
    },
  },
  variants: {
    wide: {
      true: {
        inner: {
          maxWidth: "5xl",
          paddingInlineStart: "14",
          paddingInlineEnd: "4",
          lg: { paddingInlineStart: "4", paddingInlineEnd: "4" },
        },
      },
    },
  },
});

const badge = defineRecipe({
  className: "badge",
  base: {
    paddingInline: "1.5",
    paddingBlock: "0.5",
    borderRadius: "full",
    textStyle: "badge",
    flexShrink: 0,
  },
  variants: {
    tone: {
      main: { backgroundColor: "accent.wash", color: "accent.fg" },
      detached: { backgroundColor: "subtle.wash", color: "subtle.fg" },
    },
  },
});

const toggleGroup = defineSlotRecipe({
  className: "toggleGroup",
  slots: ["root", "item"],
  base: {
    root: {
      display: "inline-flex",
      alignItems: "stretch",
      borderRadius: "lg",
      borderWidth: "1px",
      borderColor: "border",
      overflow: "hidden",
    },
    item: {
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
      backgroundColor: "subtle.bg",
      color: "secondary.fg",
      _hover: { backgroundColor: "secondary.wash" },
      "&[data-state=on]": { backgroundColor: "accent.wash", color: "accent.fg" },
    },
  },
});

const select = defineSlotRecipe({
  className: "select",
  slots: [
    "trigger",
    "content",
    "scrollButton",
    "viewport",
    "item",
    "itemIndicator",
    "emptyMessage",
    "groupLabel",
  ],
  base: {
    trigger: {
      display: "inline-flex",
      alignItems: "center",
      gap: "1",
      textStyle: "xs",
      paddingInline: "2.5",
      paddingBlock: "1",
      borderRadius: "full",
      _hover: { backgroundColor: "primary.wash" },
    },
    content: {
      zIndex: 50,
      backgroundColor: "card.bg",
      borderWidth: "1px",
      borderColor: "border",
      borderRadius: "xl",
      boxShadow: "lg",
      overflow: "hidden",
    },
    scrollButton: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "6",
    },
    viewport: { padding: "1" },
    item: {
      position: "relative",
      display: "flex",
      alignItems: "center",
      paddingInline: "8",
      paddingBlock: "2",
      textStyle: "sm",
      borderRadius: "lg",
      outline: "none",
      cursor: "pointer",
      userSelect: "none",
      _highlighted: { backgroundColor: "accent.wash", color: "accent.fg" },
    },
    itemIndicator: {
      position: "absolute",
      left: "2",
      display: "inline-flex",
      alignItems: "center",
    },
    emptyMessage: {
      paddingInline: "3",
      paddingBlock: "2",
      textStyle: "sm",
      color: "muted.fg",
    },
    groupLabel: {
      paddingInline: "2",
      paddingBlock: "1.5",
      textStyle: "xs",
      fontWeight: "semibold",
      color: "muted.fg",
      letterSpacing: "0.05em",
    },
  },
});

export default defineConfig({
  preflight: true,
  include: ["./app/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  globalCss: {
    html: {
      backgroundColor: "page.bg",
      color: "primary.fg",
      fontFamily: "sans",
    },
    body: {
      backgroundColor: "page.bg",
      color: "primary.fg",
    },
    'button:not(:disabled), [role="button"]:not(:disabled)': {
      cursor: "pointer",
    },
  },
  theme: {
    extend: {
      tokens: {
        fonts: {
          sans: {
            value:
              '"Inter", "Noto Sans JP", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
          },
          mono: { value: '"JetBrains Mono", ui-monospace, monospace' },
        },
        colors,
        shadows: {
          overlay: { value: "0 4px 10px -4px rgba(0,0,0,0.15)" },
        },
      },
      semanticTokens: {
        colors: semantic,
      },
      textStyles: {
        sm: { value: { fontSize: "0.875rem", lineHeight: "calc(1.25 / 0.875)" } },
        xs: { value: { fontSize: "0.75rem", lineHeight: "calc(1 / 0.75)" } },
        badge: {
          value: {
            fontSize: "0.625rem",
            fontFamily: "sans",
            fontWeight: "medium",
            textTransform: "uppercase",
            letterSpacing: "0.025em",
          },
        },
      },
      recipes: {
        iconButton,
        button,
        card,
        badge,
      },
      slotRecipes: {
        topbar,
        toggleGroup,
        select,
      },
    },
  },
});
