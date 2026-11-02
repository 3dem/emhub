// src/components/ui/dialog.tsx
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PORTAL_ROOT_ID, ROOT_CLASS } from "@/widget/constants";

function getWidgetPortalContainer(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;

  return (
    (document.querySelector(`#${PORTAL_ROOT_ID}`) as HTMLElement | null) ||
    (document.querySelector(`.${ROOT_CLASS}`) as HTMLElement | null) ||
    undefined
  );
}

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    style={{
      // forceTransparentOverlay
      backgroundColor: "transparent",
      backdropFilter: "none",
      opacity: 1,
    }}
    className={cn(
      "pointer-events-none fixed inset-0 z-40 bg-transparent backdrop-blur-none",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "pp-dialogOverlay",
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  container?: HTMLElement | null;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, container, ...props }, ref) => {
  const autoContainer = getWidgetPortalContainer();
  const portalContainer = container ?? autoContainer ?? undefined;

  return (
    <DialogPortal container={portalContainer}>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        // preventCloseOnInteractOutside
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        className={cn(
          "fixed left-1/2 top-1/2 z-[9999] grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
          "rounded-2xl border border-gray-200 bg-white p-6 shadow-xl",
          "dark:border-gray-800 dark:bg-gray-900",
          "duration-200",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
          "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
          "pp-dialogContent",
          className
        )}
        {...props}
      >
        {children}

        <DialogPrimitive.Close
          className={cn(
            "absolute right-4 top-4 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full",
            "border border-white/25 bg-white/10 hover:bg-white/20",
            "transition hover:bg-white hover:shadow-lg",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-800",
            "dark:border-white/20 dark:bg-white/95",
            "pp-dialogClose"
          )}
          aria-label="Close"
        >
          <X
            className="h-5 w-5"
            strokeWidth={1}
            style={{
              color: "#d2daeb",
              stroke: "#d2daeb",
            }}
          />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-gray-600 dark:text-gray-400", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
