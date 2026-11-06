import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export interface OrdiqLogoProps {
  size?: number;
  className?: string;
  alt?: string;
  variant?: "white" | "maroon";
}

/**
 * Official application logo:
 * Icon-only calendar with AI brain, circuits & gears,
 * with the red maroon / orange background completely eliminated.
 */
export function OrdiqLogo({
  size = 40,
  className,
  alt = "ORDIQ",
  variant = "white",
}: OrdiqLogoProps) {
  const src = variant === "maroon" ? "/ordiq-icon-maroon.png" : "/ordiq-icon-white.png";
  return (
    <Image
      src={src}
      width={size}
      height={size}
      alt={alt}
      priority
      // Tailwind's base styles set `height: auto` on images, which changed only one
      // dimension (Next.js warns about that). Both sides come from --logo-size;
      // callers can still override them with their own h-/w- classes.
      style={{ "--logo-size": `${size}px` } as React.CSSProperties}
      className={cn(
        "h-[var(--logo-size)] w-[var(--logo-size)] shrink-0 select-none object-contain drop-shadow-xs",
        className,
      )}
    />
  );
}
