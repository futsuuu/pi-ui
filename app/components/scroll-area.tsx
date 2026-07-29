import { ScrollArea as Primitive } from "radix-ui";

export function ScrollArea({
  className,
  viewportClassName,
  ...viewportProps
}: Primitive.ScrollAreaViewportProps &
  React.RefAttributes<HTMLDivElement> & {
    viewportClassName?: string;
  }) {
  return (
    <Primitive.Root
      scrollHideDelay={1500}
      className={`flex-1 min-h-0 min-w-0 size-full overflow-hidden${className ? ` ${className}` : ""}`}
    >
      <Primitive.Viewport
        className={`size-full min-h-0 min-w-0${viewportClassName ? ` ${viewportClassName}` : ""}`}
        {...viewportProps}
      />
      <Primitive.Scrollbar
        orientation="vertical"
        className="flex flex-row select-none touch-none p-0.5 transition-colors duration-150 ease-out w-2"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full transition-opacity opacity-30 hover:opacity-50 bg-black dark:bg-white" />
      </Primitive.Scrollbar>
      <Primitive.Scrollbar
        orientation="horizontal"
        className="flex flex-col select-none touch-none p-0.5 transition-colors duration-150 ease-out h-2"
      >
        <Primitive.Thumb className="relative flex-1 rounded-full transition-opacity opacity-30 hover:opacity-50 bg-black dark:bg-white" />
      </Primitive.Scrollbar>
      <Primitive.Corner className="bg-gray-100 dark:bg-gray-800" />
    </Primitive.Root>
  );
}
