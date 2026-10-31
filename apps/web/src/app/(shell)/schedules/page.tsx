import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function SchedulesPage() {
  return (
    <SectionPlaceholderView
      title="Schedules"
      phaseBadge="Phases 2 & 3"
      description="Generate, inspect, edit, compare, and accept candidate schedules before portal encoding."
      deliverables={[
        "Multi-profile candidate generation (Balanced, Faculty-First, Student-First) via Google OR-Tools CP-SAT",
        "Independent Python hard-constraint validation on every edit and drag-and-drop move",
        "Side-by-side candidate comparison and documented exceptions for waivable rules (D-18)",
      ]}
    />
  );
}

