import * as React from "react";
import { AppShell } from "@/features/shell/app-shell";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

