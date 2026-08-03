import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type UserConfig } from "vite";
import type {} from "vitest/config";

const baseConfig: UserConfig = {
  // React Router Vite plugin does not work in tests
  plugins: [tailwindcss(), !process.env.VITEST && reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
};

export default defineConfig({
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
});
