"use client";

import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva } from "class-variance-authority";
import { PanelLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const SIDEBAR_COOKIE_NAME = "sidebar:state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_KEYBOARD_SHORTCUT = "b";

type SidebarContextState = {
  state: "expanded" | "collapsed";
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextState | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(max-width: 768px)");
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  children,
}: {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp !== undefined ? openProp : _open;

  const setOpen = React.useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const newOpen = typeof value === "function" ? value(open) : value;
      if (openProp === undefined) _setOpen(newOpen);
      onOpenChange?.(newOpen);
    },
    [open, openProp, onOpenChange]
  );

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((prev) => !prev) : setOpen((prev) => !prev);
  }, [isMobile, setOpen, setOpenMobile]);

  const state = open ? "expanded" : "collapsed";

  React.useEffect(() => {
    if (openProp === undefined) {
      const match = document.cookie.match(
        new RegExp(`(^| )${SIDEBAR_COOKIE_NAME}=([^;]+)`)
      );
      if (match) _setOpen(match[2] === "true");
    }
  }, [openProp]);

  React.useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE_NAME}=${open}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
  }, [open]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  return (
    <SidebarContext.Provider
      value={{
        state,
        open,
        setOpen,
        isMobile,
        openMobile,
        setOpenMobile,
        toggleSidebar,
      }}
    >
      <div
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
          } as React.CSSProperties
        }
        className={cn(
          "group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full"
        )}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

const sidebarVariants = cva(
  "group/sidebar peer/sidebar flex flex-col bg-sidebar text-sidebar-foreground overflow-hidden",
  {
    variants: {
      side: {
        left: "-translate-x-full peer-data-[variant=inset]:md:translate-x-0",
        right: "translate-x-full",
      },
      variant: {
        sidebar: "",
        floating: "rounded-lg border shadow-sm",
        inset: [
          "peer-data-[variant=inset]:md:bg-sidebar",
          "peer-data-[variant=inset]:md:shadow-sm",
          "md:peer-data-[variant=inset]:m-2",
          "md:peer-data-[variant=inset]:ml-0",
          "md:peer-data-[variant=inset]:rounded-xl",
          "md:peer-data-[variant=inset]:border",
        ].join(" "),
      },
      collapsible: {
        offcanvas: "peer-data-[variant=inset]:md:shadow-sm",
        icon: "peer-data-[collapsible=icon]:w-[--sidebar-width-icon]",
        none: "",
      },
    },
    defaultVariants: {
      side: "left",
      variant: "sidebar",
      collapsible: "icon",
    },
  }
);

const Sidebar = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    side?: "left" | "right";
    variant?: "sidebar" | "floating" | "inset";
    collapsible?: "offcanvas" | "icon" | "none";
  }
>(function Sidebar(
  {
    side = "left",
    variant = "sidebar",
    collapsible = "icon",
    className,
    children,
    ...props
  },
  ref
) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === "none") {
    if (isMobile) {
      return (
        <DialogPrimitive.Root open={openMobile} onOpenChange={setOpenMobile}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0" />
            <DialogPrimitive.Popup
              data-slot="sidebar"
              data-side={side}
              className={cn(
                "fixed inset-y-0 z-50 flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground data-closed:animate-out data-open:animate-in",
                side === "left"
                  ? "left-0 data-closed:slide-out-to-left data-open:slide-in-from-left"
                  : "right-0 data-closed:slide-out-to-right data-open:slide-in-from-right",
                className
              )}
              ref={ref}
              {...props}
            >
              <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <PanelLeft className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
              {children}
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      );
    }
    return (
      <div
        data-slot="sidebar"
        data-side={side}
        data-variant={variant}
        className={cn(
          "flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground",
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <DialogPrimitive.Root open={openMobile} onOpenChange={setOpenMobile}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0" />
          <DialogPrimitive.Popup
            data-slot="sidebar"
            data-side={side}
            className={cn(
              "fixed inset-y-0 z-50 flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground data-closed:animate-out data-open:animate-in",
              side === "left"
                ? "left-0 data-closed:slide-out-to-left data-open:slide-in-from-left"
                : "right-0 data-closed:slide-out-to-right data-open:slide-in-from-right",
              className
            )}
            ref={ref}
            {...props}
          >
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2">
              <PanelLeft className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
            {children}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <div
      data-slot="sidebar"
      data-side={side}
      data-variant={variant}
      data-collapsible={collapsible === "icon" ? "icon" : undefined}
      data-state={state}
      className={cn(
        sidebarVariants({ side, variant, collapsible }),
        "peer-data-[variant=inset]:md:bg-sidebar",
        "h-svh w-[--sidebar-width] transition-[width] duration-200 ease-linear",
        collapsible === "icon" &&
          state === "collapsed" &&
          "w-[--sidebar-width-icon]",
        className
      )}
      ref={ref}
      {...props}
    >
      {children}
    </div>
  );
});

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  const { state } = useSidebar();
  return (
    <div
      data-slot="sidebar-header"
      data-state={state}
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  const { state } = useSidebar();
  return (
    <div
      data-slot="sidebar-footer"
      data-state={state}
      className={cn("flex flex-col gap-2 p-2", className)}
      {...props}
    />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-2 overflow-auto",
        className
      )}
      {...props}
    />
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  const { state } = useSidebar();

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-state={state}
      className={cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-hidden ring-sidebar-ring focus-visible:ring-2",
        className
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sidebar-group-content"
      className={cn("w-full text-sm", className)}
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn("group/menu-item relative", className)}
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  [
    "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring",
    "transition-[width,height,padding] duration-200 ease-linear",
    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    "focus-visible:ring-2",
    "active:bg-sidebar-accent active:text-sidebar-accent-foreground",
    "disabled:pointer-events-none disabled:opacity-50",
    "group-has-data-[sidebar-menu-action]/menu-item:pr-8",
    "aria-current-page:bg-sidebar-accent aria-current-page:text-sidebar-accent-foreground",
    "data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground",
    "data-state-open:hover:bg-sidebar-accent data-state-open:hover:text-sidebar-accent-foreground",
    "[&>svg]:size-4 [&>svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "",
        outline: [
          "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))]",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          "hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]",
        ].join(" "),
      },
      size: {
        default: "h-8 text-sm",
        sm: "h-7 text-xs",
        lg: "h-12 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & {
    asChild?: boolean;
    isActive?: boolean;
    tooltip?: string;
    variant?: "default" | "outline";
    size?: "default" | "sm" | "lg";
  }
>(function SidebarMenuButton(
  {
    asChild = false,
    isActive = false,
    variant,
    size,
    tooltip,
    className,
    ...props
  },
  ref
) {
  const Comp = asChild ? Slot : "button";
  const { isMobile, state } = useSidebar();

  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive || undefined}
      data-collapsible={state}
      className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
      ref={ref}
      {...props}
    />
  );

  if (!tooltip || isMobile) return button;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={<span />} closeOnClick={false}>
        {button}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner side="right" align="center" sideOffset={8}>
          <TooltipPrimitive.Popup className="rounded-md border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-side-left:slide-in-from-right-2 data-side-right:slide-in-from-left-2 data-side-top:slide-in-from-bottom-2 data-side-bottom:slide-in-from-top-2">
            {tooltip}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
});

const SidebarTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button>
>(function SidebarTrigger({ className, onClick, ...props }, ref) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7 md:hidden", className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      ref={ref}
      {...props}
    >
      <PanelLeft className="size-4" />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
});

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        "relative flex min-h-svh flex-1 flex-col bg-background",
        "peer-data-[variant=inset]:min-h-[calc(100svh-1rem)]",
        "md:peer-data-[variant=inset]:m-2",
        "md:peer-data-[variant=inset]:ml-0",
        "md:peer-data-[variant=inset]:rounded-xl",
        "md:peer-data-[variant=inset]:shadow-sm",
        "md:ml-[--sidebar-width]",
        className
      )}
      {...props}
    />
  );
}

function SidebarSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      className={cn("mx-2 w-auto bg-sidebar-border", className)}
      {...props}
    />
  );
}

export {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarFooter,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarInset,
  SidebarSeparator,
  useSidebar,
};
