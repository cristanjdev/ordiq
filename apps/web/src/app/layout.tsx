import type { Metadata } from "next";
import * as React from "react";
import "./globals.css";
import { AppProviders } from "@/features/shell/providers";

export const metadata: Metadata = {
  title: "ORDIQ — Order Meets Intelligence | MSEUF College of Engineering",
  description:
    "AI-based class scheduling decision-support system for the College of Engineering, Manuel S. Enverga University Foundation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}

