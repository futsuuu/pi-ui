import { reactRouter } from "@react-router/dev/vite";
import babel from "@rolldown/plugin-babel";
import { reactCompilerPreset } from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type UserConfig } from "vite";
import type {} from "vitest/config";

export default defineConfig(({ mode }) => {
  const baseConfig: UserConfig = {
    plugins: [
      // React Router Vite plugin does not work in tests
      !process.env.VITEST && reactRouter(),
      babel({
        presets: [
          reactCompilerPreset({
            panicThreshold: mode === "production" ? "none" : "all_errors",
          }),
        ],
      }),
    ],
    resolve: {
      tsconfigPaths: true,
    },
  };

  return {
    ...baseConfig,
    test: {
      projects: [
        {
          ...baseConfig,
          test: {
            name: "ts",
            include: ["app/**/*.test.ts"],
          },
        },
        {
          ...baseConfig,
          test: {
            name: "tsx",
            include: ["app/**/*.test.tsx"],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: "chromium" }],
            },
            setupFiles: ["./app/test-setup.tsx"],
          },
        },
      ],
    },
  };
});
