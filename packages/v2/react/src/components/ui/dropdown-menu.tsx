"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function DropdownMenu({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
  return (
    <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  );
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  );
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-copilotkit
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          "cpk:bg-popover cpk:text-popover-foreground cpk:data-[state=open]:animate-in cpk:data-[state=closed]:animate-out cpk:data-[state=closed]:fade-out-0 cpk:data-[state=open]:fade-in-0 cpk:data-[state=closed]:zoom-out-95 cpk:data-[state=open]:zoom-in-95 cpk:data-[side=bottom]:slide-in-from-top-2 cpk:data-[side=left]:slide-in-from-right-2 cpk:data-[side=right]:slide-in-from-left-2 cpk:data-[side=top]:slide-in-from-bottom-2 cpk:z-50 cpk:max-h-(--radix-dropdown-menu-content-available-height) cpk:min-w-[8rem] cpk:origin-(--radix-dropdown-menu-content-transform-origin) cpk:overflow-x-hidden cpk:overflow-y-auto cpk:rounded-md cpk:border cpk:p-1 cpk:shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  );
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "cpk:focus:bg-accent cpk:focus:text-accent-foreground cpk:data-[variant=destructive]:text-destructive cpk:data-[variant=destructive]:focus:bg-destructive/10 cpk:dark:data-[variant=destructive]:focus:bg-destructive/20 cpk:data-[variant=destructive]:focus:text-destructive cpk:data-[variant=destructive]:*:[svg]:!text-destructive cpk:[&_svg:not([class*='text-'])]:text-muted-foreground cpk:relative cpk:flex cpk:cursor-default cpk:items-center cpk:gap-2 cpk:rounded-sm cpk:px-2 cpk:py-1.5 cpk:text-sm cpk:outline-hidden cpk:select-none cpk:data-[disabled]:pointer-events-none cpk:data-[disabled]:opacity-50 cpk:data-[inset]:pl-8 cpk:[&_svg]:pointer-events-none cpk:[&_svg]:shrink-0 cpk:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "cpk:focus:bg-accent cpk:focus:text-accent-foreground cpk:relative cpk:flex cpk:cursor-default cpk:items-center cpk:gap-2 cpk:rounded-sm cpk:py-1.5 cpk:pr-2 cpk:pl-8 cpk:text-sm cpk:outline-hidden cpk:select-none cpk:data-[disabled]:pointer-events-none cpk:data-[disabled]:opacity-50 cpk:[&_svg]:pointer-events-none cpk:[&_svg]:shrink-0 cpk:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="cpk:pointer-events-none cpk:absolute cpk:left-2 cpk:flex cpk:size-3.5 cpk:items-center cpk:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="cpk:size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
  return (
    <DropdownMenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "cpk:focus:bg-accent cpk:focus:text-accent-foreground cpk:relative cpk:flex cpk:cursor-default cpk:items-center cpk:gap-2 cpk:rounded-sm cpk:py-1.5 cpk:pr-2 cpk:pl-8 cpk:text-sm cpk:outline-hidden cpk:select-none cpk:data-[disabled]:pointer-events-none cpk:data-[disabled]:opacity-50 cpk:[&_svg]:pointer-events-none cpk:[&_svg]:shrink-0 cpk:[&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <span className="cpk:pointer-events-none cpk:absolute cpk:left-2 cpk:flex cpk:size-3.5 cpk:items-center cpk:justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CircleIcon className="cpk:size-2 cpk:fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "cpk:px-2 cpk:py-1.5 cpk:text-sm cpk:font-medium cpk:data-[inset]:pl-8",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("cpk:bg-border cpk:-mx-1 cpk:my-1 cpk:h-px", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "cpk:text-muted-foreground cpk:ml-auto cpk:text-xs cpk:tracking-widest",
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "cpk:focus:bg-accent cpk:focus:text-accent-foreground cpk:data-[state=open]:bg-accent cpk:data-[state=open]:text-accent-foreground cpk:flex cpk:cursor-default cpk:items-center cpk:rounded-sm cpk:px-2 cpk:py-1.5 cpk:text-sm cpk:outline-hidden cpk:select-none cpk:data-[inset]:pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="cpk:ml-auto cpk:size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="dropdown-menu-sub-content"
      className={cn(
        "cpk:bg-popover cpk:text-popover-foreground cpk:data-[state=open]:animate-in cpk:data-[state=closed]:animate-out cpk:data-[state=closed]:fade-out-0 cpk:data-[state=open]:fade-in-0 cpk:data-[state=closed]:zoom-out-95 cpk:data-[state=open]:zoom-in-95 cpk:data-[side=bottom]:slide-in-from-top-2 cpk:data-[side=left]:slide-in-from-right-2 cpk:data-[side=right]:slide-in-from-left-2 cpk:data-[side=top]:slide-in-from-bottom-2 cpk:z-50 cpk:min-w-[8rem] cpk:origin-(--radix-dropdown-menu-content-transform-origin) cpk:overflow-hidden cpk:rounded-md cpk:border cpk:p-1 cpk:shadow-lg",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
