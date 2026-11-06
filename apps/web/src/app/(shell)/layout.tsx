import * as React from "react";
import { AuthSessionProvider } from "@/features/auth/auth-session-provider";
import { AppShell } from "@/features/shell/app-shell";

export default function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthSessionProvider>
      <AppShell>{children}</AppShell>
    </AuthSessionProvider>
  );
}
