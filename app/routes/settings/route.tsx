import { Layers, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { data, redirect } from "react-router";
import * as v from "valibot";

import { useTheme, type Theme } from "~/contexts/theme";
import { providerAuthManagerContext } from "~/router-contexts";

import type { Route } from "./+types/route";
import { isJsonContentRequest, isSameOriginRequest } from "./auth-guards";

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Settings" }];
}

const SettingsActionSchema = v.variant("type", [
  v.object({
    type: v.literal("start_login"),
    providerId: v.pipe(v.string(), v.minLength(1)),
    authType: v.picklist(["api_key", "oauth"]),
  }),
  v.object({
    type: v.literal("start_removal"),
    providerId: v.pipe(v.string(), v.minLength(1)),
    confirmed: v.literal(true),
  }),
]);

export async function loader({ request, context }: Route.LoaderArgs) {
  const manager = context.get(providerAuthManagerContext);
  const providers = await manager.listProviders();
  const operationId = new URL(request.url).searchParams.get("authOperation");
  if (!operationId) return { providers, operation: null };
  const operation = manager.getSnapshot(operationId);
  if (!operation) throw redirect("/settings");
  return { providers, operation };
}

export async function action({ request, context }: Route.ActionArgs) {
  if (!isSameOriginRequest(request)) {
    return data({ error: "Forbidden" }, { status: 403 });
  }
  if (!isJsonContentRequest(request)) {
    return data({ error: "Unsupported media type" }, { status: 415 });
  }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return data({ error: "Invalid request" }, { status: 400 });
  }
  const result = v.safeParse(SettingsActionSchema, parsed);
  if (!result.success) {
    return data({ error: "Invalid request" }, { status: 400 });
  }
  const manager = context.get(providerAuthManagerContext);
  if (result.output.type === "start_login") {
    const started = await manager.startLogin(result.output.providerId, result.output.authType);
    if (!started.ok) {
      if (started.error === "conflict") {
        return data({ error: "conflict", operationId: started.operationId }, { status: 409 });
      }
      if (started.error === "unknown_provider") {
        return data({ error: "unknown_provider" }, { status: 404 });
      }
      return data({ error: "unsupported_auth" }, { status: 400 });
    }
    throw redirect(`/settings?authOperation=${encodeURIComponent(started.operationId)}`);
  }
  const started = await manager.startRemoval(result.output.providerId);
  if (!started.ok) {
    if (started.error === "conflict") {
      return data({ error: "conflict", operationId: started.operationId }, { status: 409 });
    }
    return data({ error: "no_stored_credential" }, { status: 404 });
  }
  throw redirect(`/settings?authOperation=${encodeURIComponent(started.operationId)}`);
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
