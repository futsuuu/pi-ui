import { defineConfig } from "oxlint";

export default defineConfig({
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: "error",
    typeAware: true,
    typeCheck: true,
  },
});
