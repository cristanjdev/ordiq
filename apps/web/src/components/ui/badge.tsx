import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--ordiq-maroon)]/10 text-[var(--ordiq-maroon)] dark:bg-[var(--ordiq-orange)]/20 dark:text-[var(--ordiq-orange)]",
        orange:
          "bg-[var(--ordiq-orange)]/15 text-[var(--ordiq-orange-deep)] dark:bg-[var(--ordiq-orange)]/25 dark:text-[#fdba74]",
        success:
          "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
        warning:
          "bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
        danger:
          "bg-red-500/15 text-red-700 dark:bg-red-500/20 dark:text-red-300",
        neutral:
          "bg-[var(--ordiq-surface-muted)] text-[var(--ordiq-muted)] border border-[var(--ordiq-border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

