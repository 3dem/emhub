import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // pxBasedSizingToAvoidHostRemScaling
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-all " +
    "disabled:pointer-events-none disabled:opacity-50 " +
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 " +
    "[&_svg:not([class*='size-'])]:size-4 shrink-0 " +
    "outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] " +
    "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive " +
    "leading-[1.1]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-sm hover:bg-destructive/90 " +
          "focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-sm hover:bg-accent hover:text-accent-foreground " +
          "dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // pxHeightsAndFontSizesToAvoidHostInfluence
        default: "h-[36px] px-[16px] py-[8px] text-[14px] has-[>svg]:px-[12px]",
        sm: "h-[32px] rounded-md gap-1.5 px-[12px] text-[13px] has-[>svg]:px-[10px]",
        lg: "h-[40px] rounded-md px-[24px] text-[14px] has-[>svg]:px-[16px]",
        icon: "size-[36px] text-[14px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  // defaultTypeButtonToAvoidUnexpectedFormSubmits
  const resolvedProps = { ...props } as React.ComponentProps<"button">;
  if (!asChild && !resolvedProps.type) {
    resolvedProps.type = "button";
  }

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...resolvedProps}
    />
  );
}

export { Button, buttonVariants };
