import type { UserMessage as Data, TextContent } from "@earendil-works/pi-ai";

export type Props = Pick<Data, "role" | "content">;

export function UserMessage({ content }: Props) {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  if (!text.trim()) return null;

  return (
    <div className="flex justify-end">
      <div className="rounded-xl px-4 py-3 whitespace-pre-wrap break-words max-w-[80%] bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700">
        {text.trim()}
      </div>
    </div>
  );
}
