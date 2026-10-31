import { SectionPlaceholderView } from "@/features/workspace/section-placeholder-view";

export default function CoursesSectionsPage() {
  return (
    <SectionPlaceholderView
      title="Courses & Sections"
      phaseBadge="Phase 1B"
      description="Manage subjects, lecture/laboratory offerings, section-level student counts (no individual student records), and fixed external blocks."
      deliverables={[
        "7 engineering programs (Civil, Computer, Electrical, Electronics, Geodetic, Industrial, Mechanical)",
        "Section-level student counts only (D-21 data minimization)",
        "Locked FixedBlocks for General Education, PATHFIT, and external building classes (D-23)",
      ]}
    />
  );
}

