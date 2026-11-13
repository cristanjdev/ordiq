import type { Metadata } from "next";
import { ScheduleWorkspace } from "@/features/schedules/schedule-workspace";

export const metadata: Metadata = { title: "Schedules" };

export default function SchedulesPage() {
  return <ScheduleWorkspace />;
}
