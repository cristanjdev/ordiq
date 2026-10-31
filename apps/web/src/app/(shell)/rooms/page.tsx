import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function RoomsPage() {
  return (
    <SectionPlaceholderView
      title="Rooms & Laboratories"
      phaseBadge="Phase 1B"
      description="Manage lecture rooms (≥40 capacity) and laboratories (≥30 capacity), equipment tags, and maintenance restrictions."
      deliverables={[
        "Room capacity and type validation (HC-04, HC-05)",
        "Room availability and maintenance blackouts (HC-10, HC-14)",
        "Efficient room-capacity matching (SC-08)",
      ]}
    />
  );
}

