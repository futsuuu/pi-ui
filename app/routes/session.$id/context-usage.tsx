import type { ContextUsage } from "@earendil-works/pi-coding-agent";

type ContextUsageIndicatorProps = {
  usage: ContextUsage | null;
};

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "?";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

export function ContextUsageIndicator({ usage }: ContextUsageIndicatorProps) {
  if (!usage) return null;

  const percent =
    usage.percent !== null && Number.isFinite(usage.percent)
      ? Math.min(Math.max(usage.percent, 0), 100)
      : null;
  const progress = percent ?? 0;
  const label = percent === null ? "Context usage unknown" : `${Math.round(percent)}% context used`;
  const accessibility =
    percent === null
      ? { role: "img" as const, "aria-label": "Context usage unknown" }
      : {
          role: "meter" as const,
          "aria-label": "Context usage",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": percent,
          "aria-valuetext": label,
        };
  const color =
    progress >= 90
      ? "var(--color-red-500)"
      : progress >= 70
        ? "var(--color-amber-500)"
        : "var(--color-green-500)";

  return (
    <div
      {...accessibility}
      title={`${label} (${formatTokens(usage.tokens)} / ${formatTokens(usage.contextWindow)} tokens)`}
      className="relative ml-auto size-8 shrink-0 rounded-full bg-gray-200 dark:bg-gray-800"
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from 0deg, ${color} 0 ${progress}%, transparent ${progress}% 100%)`,
        }}
      />
      <span
        aria-hidden="true"
        className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white text-[10px] font-semibold tabular-nums text-gray-700 dark:bg-gray-900 dark:text-gray-200"
      >
        {percent === null ? "?" : `${Math.round(percent)}%`}
      </span>
    </div>
  );
}
