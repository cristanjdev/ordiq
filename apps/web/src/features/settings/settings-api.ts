"use client";

import { useQuery } from "@tanstack/react-query";
import {
  DEFAULT_SYSTEM_SETTINGS,
  type SystemSettings,
} from "@/lib/system-settings";

export const SYSTEM_SETTINGS_QUERY_KEY = ["system-settings"] as const;

export async function fetchSystemSettings(): Promise<SystemSettings> {
  const res = await fetch("/api/v1/settings", { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Settings could not load (HTTP ${res.status}).`);
  return ((await res.json()) as { settings: SystemSettings }).settings;
}

/** Saved system settings. Until they load, the defaults are assumed. */
export function useSystemSettings() {
  const query = useQuery({
    queryKey: SYSTEM_SETTINGS_QUERY_KEY,
    queryFn: fetchSystemSettings,
    staleTime: 60_000,
  });
  return { ...query, settings: query.data ?? DEFAULT_SYSTEM_SETTINGS };
}
