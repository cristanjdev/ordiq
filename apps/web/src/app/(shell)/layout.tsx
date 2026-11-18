import * as React from "react";
import { cookies } from "next/headers";
import { AuthSessionProvider } from "@/features/auth/auth-session-provider";
import { AppShell } from "@/features/shell/app-shell";
import { SIDEBAR_COOKIE, sidebarOpenFromCookie } from "@/features/shell/sidebar-preference";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The sidebar's collapsed state is remembered in a cookie, so a refresh
  // renders it the way the Dean left it.
  const cookieStore = await cookies();
  const initialSidebarOpen = sidebarOpenFromCookie(cookieStore.get(SIDEBAR_COOKIE)?.value);
  return (
    <AuthSessionProvider>
      <AppShell initialSidebarOpen={initialSidebarOpen}>{children}</AppShell>
    </AuthSessionProvider>
  );
}
