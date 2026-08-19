import { Layers, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";

import { useTheme, type Theme } from "~/contexts/theme";

import type { Route } from "./+types/route";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Settings" }];
}

const THEME_OPTIONS: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function Settings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Layers className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-gray-900 dark:text-gray-100">Settings</span>
        </div>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full p-6">
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">Theme</h2>
            <ToggleGroup.Root
              type="single"
              value={theme}
              onValueChange={(value) => {
                if (value) setTheme(value as Theme);
              }}
              aria-label="Theme"
              className="inline-flex items-stretch rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
            >
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <ToggleGroup.Item
                  key={value}
                  value={value}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 data-[state=on]:bg-blue-50 dark:data-[state=on]:bg-blue-900/40 data-[state=on]:text-blue-700 dark:data-[state=on]:text-blue-400"
                >
                  <Icon className="w-4 h-4" />
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
