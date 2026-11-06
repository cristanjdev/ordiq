import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Also used to style links that look like buttons. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ordiq-orange)] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--ordiq-maroon)] text-white shadow-sm hover:bg-[var(--ordiq-maroon-deep)]",
        accent:
          "bg-gradient-to-r from-[var(--ordiq-orange)] to-[var(--ordiq-maroon)] text-white shadow-sm hover:opacity-95",
        outline:
          "border border-[var(--ordiq-border)] bg-[var(--ordiq-surface)] text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface-muted)]",
        maroonOutline:
          "border border-[var(--ordiq-maroon)] bg-transparent text-[var(--ordiq-maroon)] hover:bg-[var(--ordiq-maroon)]/10 dark:border-[var(--ordiq-orange)] dark:text-[var(--ordiq-orange)]",
        ghost:
          "text-[var(--ordiq-ink)] hover:bg-[var(--ordiq-surface-muted)]",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-lg px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

