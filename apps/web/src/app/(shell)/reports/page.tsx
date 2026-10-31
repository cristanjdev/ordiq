import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function ReportsPage() {
  return (
    <SectionPlaceholderView
      title="Reports"
      phaseBadge="Phase 6"
      description="Export validated schedules, workload summaries, room utilization, conflict reports, and portal-encoding workbooks."
      deliverables={[
        "PDF and Excel exports per section, faculty, and room",
        "Baseline comparison report against 1st Semester A.Y. 2026–2027",
        "Portal encoding Excel export and Stage 1–3 evaluation evidence records",
      ]}
    />
  );
}

