import type { Metadata } from "next";
import { RulesWorkspace } from "@/features/rules/rules-workspace";

export const metadata: Metadata = { title: "Rules & Preferences" };

export default function RulesAndPreferencesPage() {
  return <RulesWorkspace />;
}
