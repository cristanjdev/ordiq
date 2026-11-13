import type { Metadata } from "next";
import { CurriculumWorkspace } from "@/features/curriculum/curriculum-workspace";
import { ProgramsTermsSection } from "@/features/curriculum/programs-terms-section";

export const metadata: Metadata = { title: "Courses & Sections" };

export default function CoursesSectionsPage() {
  return (
    <div className="space-y-5">
      <CurriculumWorkspace />
      <ProgramsTermsSection />
    </div>
  );
}
