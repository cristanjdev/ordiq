import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function RulesPage() {
  return (
    <SectionPlaceholderView
      title="Rules & Preferences"
      phaseBadge="Phase 2"
      description="Configure hard constraints (HC-01 to HC-15), soft preference weights (SC-01 to SC-16), and stakeholder approval status."
      deliverables={[
        "Non-waivable double-booking rules (HC-01 Faculty, HC-02 Room, HC-03 Section)",
        "Stakeholder approval toggle for soft preferences (SC-01 to SC-16)",
        "Dean directives created via workspace or AI Assistant",
      ]}
    />
  );
}

