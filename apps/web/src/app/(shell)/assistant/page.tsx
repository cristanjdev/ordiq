import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function AssistantPage() {
  return (
    <SectionPlaceholderView
      title="AI Assistant"
      phaseBadge="Phase 4"
      description="Full-page GPT-style assistant in English, Filipino, and Taglish with pseudonymized privacy gateway protection."
      deliverables={[
        "Automatic pseudonymization of faculty names (Faculty.alias) before any LLM call",
        "14 read and candidate tools with zero direct database write path",
        "Validated ChangeProposal cards requiring explicit Dean confirmation",
      ]}
    />
  );
}

