"use client";

import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

const Combobox = ComboboxPrimitive.Root;

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  ...props
}: ComboboxPrimitive.Input.Props & {
  showTrigger?: boolean;
}) {
  return (
    <InputGroup className={cn("h-7 w-full min-w-0", className)}>
      <ComboboxPrimitive.Input
        className="placeholder:text-muted-foreground h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-xs shadow-none outline-none focus-visible:ring-0"
        data-slot="input-group-control"
        disabled={disabled}
        {...props}
      />
      {showTrigger ? (
        <InputGroupAddon align="inline-end">
          <ComboboxPrimitive.Trigger
            disabled={disabled}
            render={<InputGroupButton size="icon-xs" variant="ghost" />}
          >
            <ChevronDownIcon className="text-muted-foreground size-3" />
          </ComboboxPrimitive.Trigger>
        </InputGroupAddon>
      ) : null}
      {children}
    </InputGroup>
  );
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      className={cn("[&_svg:not([class*='size-'])]:size-4", className)}
      data-slot="combobox-trigger"
      {...props}
    >
      {children}
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxContent({
  align = "start",
  alignOffset = 0,
  className,
  side = "top",
  sideOffset = 4,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<
    ComboboxPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
        collisionPadding={8}
        side={side}
        sideOffset={sideOffset}
      >
        <ComboboxPrimitive.Popup
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 group/combobox-content relative max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) min-w-0 origin-(--transform-origin) overflow-hidden rounded-lg shadow-md ring-1 duration-100",
            className
          )}
          data-slot="combobox-content"
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      className={cn(
        "no-scrollbar scroll-fade max-h-[min(12rem,var(--available-height))] scroll-py-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0",
        className
      )}
      data-slot="combobox-list"
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-xs outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50",
        className
      )}
      data-slot="combobox-item"
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute right-2">
        <CheckIcon className="size-3" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      className={cn(
        "text-muted-foreground hidden w-full justify-center py-2 text-center text-xs group-data-empty/combobox-content:flex",
        className
      )}
      data-slot="combobox-empty"
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
};
