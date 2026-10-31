import * as React from "react";
import { cn } from "@/lib/utils";

export interface OrdiqLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Vector recreation of Figure 3 ("ORDIQ Application Logo"):
 * Rounded orange-to-maroon gradient square containing a calendar grid
 * and stylized AI circuit brain.
 */
export function OrdiqLogo({ size = 40, className, ...props }: OrdiqLogoProps) {
  const gradId = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 select-none", className)}
      aria-label="ORDIQ Logo"
      {...props}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="48%" stopColor="#B91C1C" />
          <stop offset="100%" stopColor="#4C0509" />
        </linearGradient>
      </defs>

      {/* Rounded square background */}
      <rect x="4" y="4" width="112" height="112" rx="26" fill={`url(#${gradId})`} />
      <rect
        x="4.75"
        y="4.75"
        width="110.5"
        height="110.5"
        rx="25.25"
        stroke="rgba(255,255,255,0.28)"
        strokeWidth="1.5"
      />

      {/* Calendar frame */}
      <rect
        x="20"
        y="27"
        width="80"
        height="72"
        rx="11"
        stroke="#FFFFFF"
        strokeWidth="5"
      />
      {/* Calendar top header bar */}
      <path
        d="M20 38C20 31.9249 24.9249 27 31 27H89C95.0751 27 100 31.9249 100 38V42H20V38Z"
        fill="#FFFFFF"
      />

      {/* Three calendar binder rings */}
      <rect x="35" y="18" width="7" height="15" rx="3.5" fill="#FFFFFF" />
      <rect x="56.5" y="18" width="7" height="15" rx="3.5" fill="#FFFFFF" />
      <rect x="78" y="18" width="7" height="15" rx="3.5" fill="#FFFFFF" />

      {/* Background calendar cells */}
      <g fill="rgba(255,255,255,0.22)">
        <rect x="26" y="48" width="11" height="9" rx="2" />
        <rect x="26" y="60" width="11" height="9" rx="2" />
        <rect x="26" y="72" width="11" height="9" rx="2" />
        <rect x="26" y="84" width="11" height="9" rx="2" />
        <rect x="83" y="48" width="11" height="9" rx="2" />
        <rect x="83" y="60" width="11" height="9" rx="2" />
        <rect x="83" y="72" width="11" height="9" rx="2" />
        <rect x="83" y="84" width="11" height="9" rx="2" />
      </g>

      {/* AI Stylized Brain (Left & Right Hemispheres + Circuit Nodes) */}
      <path
        d="M57 46C51 46 46.5 49.5 46 54.5C41.5 55.5 38.5 59.5 38.5 64.5C38.5 69 41 72.5 44.5 74C43.5 78.5 46.5 84 52 85.5C54.8 86.2 57 84.5 57 81.5V46Z"
        fill="rgba(127, 29, 29, 0.85)"
        stroke="#FFFFFF"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M63 46C69 46 73.5 49.5 74 54.5C78.5 55.5 81.5 59.5 81.5 64.5C81.5 69 79 72.5 75.5 74C76.5 78.5 73.5 84 68 85.5C65.2 86.2 63 84.5 63 81.5V46Z"
        fill="rgba(127, 29, 29, 0.85)"
        stroke="#FFFFFF"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />

      {/* Circuit traces and nodes */}
      <path
        d="M52 54V64L46 68M68 54V62L73 66M52 76L49 72M68 75L72 71"
        stroke="#FFFFFF"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="52" cy="53" r="2.5" fill="#FFFFFF" />
      <circle cx="46" cy="68" r="2.5" fill="#FFFFFF" />
      <circle cx="52" cy="77" r="2.5" fill="#FFFFFF" />
      <circle cx="68" cy="53" r="2.5" fill="#FFFFFF" />
      <circle cx="73" cy="66" r="2.5" fill="#FFFFFF" />
      <circle cx="68" cy="76" r="2.5" fill="#FFFFFF" />
    </svg>
  );
}

