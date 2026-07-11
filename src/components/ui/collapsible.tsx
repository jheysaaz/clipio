"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface CollapsibleProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

const CollapsibleContext = React.createContext<{
  isOpen: boolean;
  disabled: boolean;
  onToggle: () => void;
} | null>(null);

function CollapsibleProvider({
  open,
  onOpenChange,
  disabled,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = React.useState(open ?? false);
  const isDisabled = disabled ?? false;

  const handleToggle = React.useCallback(() => {
    const next = !isOpen;
    if (!isDisabled) {
      setIsOpen(next);
      onOpenChange?.(next);
    }
  }, [isOpen, isDisabled, onOpenChange]);

  return (
    <CollapsibleContext.Provider
      value={{ isOpen, disabled: isDisabled, onToggle: handleToggle }}
    >
      {children}
    </CollapsibleContext.Provider>
  );
}

function Collapsible({
  className,
  children,
  open,
  onOpenChange,
  disabled,
}: CollapsibleProps) {
  return (
    <CollapsibleProvider
      open={open}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <div data-slot="collapsible" className={cn("w-full", className)}>
        {children}
      </div>
    </CollapsibleProvider>
  );
}

interface CollapsibleTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  disabled?: boolean;
  children: React.ReactNode;
}

function CollapsibleTrigger({
  className,
  children,
  disabled,
  ...props
}: CollapsibleTriggerProps) {
  const context = React.useContext(CollapsibleContext);
  const isOpen = context?.isOpen ?? false;
  const handleToggle = context?.onToggle;

  return (
    <button
      type="button"
      data-slot="collapsible-trigger"
      className={cn(
        "flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-all hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      onClick={handleToggle}
      disabled={disabled}
      {...props}
    >
      {children}
      <ChevronDown
        className={cn(
          "h-4 w-4 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-180"
        )}
        strokeWidth={1.5}
      />
    </button>
  );
}

interface CollapsibleContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function CollapsibleContent({
  className,
  children,
  ...props
}: CollapsibleContentProps) {
  const context = React.useContext(CollapsibleContext);
  const isOpen = context?.isOpen ?? false;

  return (
    <div
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden text-sm transition-all duration-200",
        isOpen ? "animate-accordion-down" : "animate-accordion-up",
        className
      )}
      {...props}
    >
      <div className="pt-4 pb-2">{children}</div>
    </div>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
