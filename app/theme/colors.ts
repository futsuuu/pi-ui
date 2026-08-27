// Color scale values copied verbatim from Tailwind CSS v4
// (node_modules/tailwindcss/theme.css) so that migrating utilities to
// semantic tokens never shifts a single color value.
export const scale = (values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([step, value]) => [step, { value }]));

export const gray = scale({
  "50": "oklch(98.5% 0.002 247.839)",
  "100": "oklch(96.7% 0.003 264.542)",
  "200": "oklch(92.8% 0.006 264.531)",
  "300": "oklch(87.2% 0.01 258.338)",
  "400": "oklch(70.7% 0.022 261.325)",
  "500": "oklch(55.1% 0.027 264.364)",
  "600": "oklch(44.6% 0.03 256.802)",
  "700": "oklch(37.3% 0.034 259.733)",
  "800": "oklch(27.8% 0.033 256.848)",
  "900": "oklch(21% 0.034 264.665)",
  "950": "oklch(13% 0.028 261.692)",
});

export const red = scale({
  "50": "oklch(97.1% 0.013 17.38)",
  "100": "oklch(93.6% 0.032 17.717)",
  "200": "oklch(88.5% 0.062 18.334)",
  "300": "oklch(80.8% 0.114 19.571)",
  "400": "oklch(70.4% 0.191 22.216)",
  "500": "oklch(63.7% 0.237 25.331)",
  "600": "oklch(57.7% 0.245 27.325)",
  "700": "oklch(50.5% 0.213 27.518)",
  "800": "oklch(44.4% 0.177 26.899)",
  "900": "oklch(39.6% 0.141 25.723)",
  "950": "oklch(25.8% 0.092 26.042)",
});

export const green = scale({
  "50": "oklch(98.2% 0.018 155.826)",
  "100": "oklch(96.2% 0.044 156.743)",
  "200": "oklch(92.5% 0.084 155.995)",
  "300": "oklch(87.1% 0.15 154.449)",
  "400": "oklch(79.2% 0.209 151.711)",
  "500": "oklch(72.3% 0.219 149.579)",
  "600": "oklch(62.7% 0.194 149.214)",
  "700": "oklch(52.7% 0.154 150.069)",
  "800": "oklch(44.8% 0.119 151.328)",
  "900": "oklch(39.3% 0.095 152.535)",
  "950": "oklch(26.6% 0.065 152.934)",
});

export const blue = scale({
  "50": "oklch(97% 0.014 254.604)",
  "100": "oklch(93.2% 0.032 255.585)",
  "200": "oklch(88.2% 0.059 254.128)",
  "300": "oklch(80.9% 0.105 251.813)",
  "400": "oklch(70.7% 0.165 254.624)",
  "500": "oklch(62.3% 0.214 259.815)",
  "600": "oklch(54.6% 0.245 262.881)",
  "700": "oklch(48.8% 0.243 264.376)",
  "800": "oklch(42.4% 0.199 265.638)",
  "900": "oklch(37.9% 0.146 265.522)",
  "950": "oklch(28.2% 0.091 267.935)",
});

export const amber = scale({
  "50": "oklch(98.7% 0.022 95.277)",
  "100": "oklch(96.2% 0.059 95.617)",
  "200": "oklch(92.4% 0.12 95.746)",
  "300": "oklch(87.9% 0.169 91.605)",
  "400": "oklch(82.8% 0.189 84.429)",
  "500": "oklch(76.9% 0.188 70.08)",
  "600": "oklch(66.6% 0.179 58.318)",
  "700": "oklch(55.5% 0.163 48.998)",
  "800": "oklch(47.3% 0.137 46.201)",
  "900": "oklch(41.4% 0.112 45.904)",
  "950": "oklch(27.9% 0.077 45.635)",
});

export const colors = { gray, red, green, blue, amber };

const washAlpha = 10;
const wash = (token: string) => `{colors.${token}/${washAlpha}}`;

export const semantic = {
  page: {
    bg: { value: { base: "{colors.gray.50}", _dark: "{colors.gray.950}" } },
  },
  primary: {
    fg: { value: { base: "{colors.gray.800}", _dark: "{colors.gray.100}" } },
    wash: { value: wash("primary.fg") },
  },
  secondary: {
    fg: { value: { base: "{colors.gray.700}", _dark: "{colors.gray.300}" } },
    wash: { value: wash("secondary.fg") },
  },
  accent: {
    fg: { value: { base: "{colors.blue.700}", _dark: "{colors.blue.400}" } },
    wash: { value: wash("accent.fg") },
  },
  subtle: {
    bg: { value: { base: "{colors.gray.100}", _dark: "{colors.gray.800}" } },
    fg: { value: { base: "{colors.gray.400}", _dark: "{colors.gray.500}" } },
    wash: { value: wash("subtle.fg") },
  },
  muted: {
    fg: { value: { base: "{colors.gray.500}", _dark: "{colors.gray.400}" } },
    wash: { value: wash("muted.fg") },
  },
  disabled: {
    bg: { value: { base: "{colors.gray.300}", _dark: "{colors.gray.700}" } },
  },
  inverse: {
    fg: { value: { base: "{colors.white}", _dark: "{colors.white}" } },
  },

  action: {
    DEFAULT: { value: { base: "{colors.blue.600}", _dark: "{colors.blue.600}" } },
    hover: {
      value: "color-mix(in srgb, var(--colors-action) 90%, white 10%)",
    },
  },
  success: {
    DEFAULT: { value: { base: "{colors.green.600}", _dark: "{colors.green.400}" } },
    icon: { value: { base: "{colors.green.500}", _dark: "{colors.green.400}" } },
    wash: { value: wash("success") },
  },
  danger: {
    DEFAULT: { value: { base: "{colors.red.600}", _dark: "{colors.red.400}" } },
    strong: { value: { base: "{colors.red.700}", _dark: "{colors.red.300}" } },
    border: { value: { base: "{colors.red.200}", _dark: "{colors.red.800}" } },
    solid: { value: { base: "{colors.red.600}", _dark: "{colors.red.600}" } },
    solidHover: {
      value: "color-mix(in srgb, var(--colors-danger-solid) 90%, white 10%)",
    },
    icon: { value: { base: "{colors.red.500}", _dark: "{colors.red.400}" } },
    wash: { value: wash("danger") },
  },
  warning: {
    DEFAULT: { value: { base: "{colors.amber.600}", _dark: "{colors.amber.400}" } },
    fg: { value: { base: "{colors.amber.800}", _dark: "{colors.amber.200}" } },
    strong: { value: { base: "{colors.amber.700}", _dark: "{colors.amber.300}" } },
    icon: { value: { base: "{colors.amber.500}", _dark: "{colors.amber.400}" } },
    wash: { value: wash("warning") },
  },
  info: { DEFAULT: { value: { base: "{colors.blue.500}", _dark: "{colors.blue.400}" } } },

  border: {
    DEFAULT: { value: { base: "{colors.gray.200}", _dark: "{colors.gray.700}" } },
  },
  panel: {
    bg: { value: { base: "{colors.white}", _dark: "{colors.gray.900}" } },
    border: { value: { base: "{colors.gray.200}", _dark: "{colors.gray.800}" } },
  },
  divider: {
    border: { value: { base: "{colors.gray.100}", _dark: "{colors.gray.800}" } },
  },
  card: {
    bg: { value: { base: "{colors.white}", _dark: "{colors.gray.800}" } },
  },
  overlay: {
    bg: { value: { base: "{colors.black/40}" } },
  },
  scroll: {
    bg: { value: { base: "{colors.black}", _dark: "{colors.white}" } },
  },
};
