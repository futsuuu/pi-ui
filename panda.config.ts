import { defineConfig, defineRecipe, defineSlotRecipe } from "@pandacss/dev";

import { colors, semantic } from "./app/theme/colors";

const iconButton = defineRecipe({
  className: "iconButton",
  base: {
    padding: "2",
    borderRadius: "lg",
    color: "fg.muted",
    transitionProperty: "colors",
    transitionDuration: "150ms",
    _hover: { backgroundColor: "bg.hover" },
  },
  variants: {
    emphasis: {
      onHover: {
        _hover: { color: "fg.primary", backgroundColor: "bg.hover" },
      },
    },
  },
});

const button = defineRecipe({
  className: "button",
  base: {
    borderRadius: "lg",
    color: "fg.inverse",
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
      panel: { backgroundColor: "bg.panel", borderColor: "border.panel" },
      elevated: { backgroundColor: "bg.card", borderColor: "border", boxShadow: "overlay" },
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
      backgroundColor: "bg.panel",
      borderBottomWidth: "1px",
      borderColor: "border.panel",
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

export default defineConfig({
  preflight: true,
  include: ["./app/**/*.{ts,tsx}"],
  exclude: [],
  outdir: "styled-system",
  globalCss: {
    html: {
      backgroundColor: "bg.page",
      color: "fg.primary",
      fontFamily: "sans",
    },
    body: {
      backgroundColor: "bg.page",
      color: "fg.primary",
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
      },
      recipes: {
        iconButton,
        button,
        card,
      },
      slotRecipes: {
        topbar,
      },
    },
  },
});
