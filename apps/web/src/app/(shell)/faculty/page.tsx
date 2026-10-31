import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function FacultyPage() {
  return (
    <SectionPlaceholderView
      title="Faculty"
      phaseBadge="Phase 1B"
      description="Manage the 44 College of Engineering faculty records, specializations, employment types, maximum teaching loads, and declared availability."
      deliverables={[
        "Editable AG Grid for Full-Time Permanent, Full-Time Non-Permanent, Part-Time, and Visiting faculty",
        "Automatic Faculty.alias pseudonym generation for the LLM Privacy Gateway",
        "Availability windows and survey preference imports",
      ]}
    />
  );
}

