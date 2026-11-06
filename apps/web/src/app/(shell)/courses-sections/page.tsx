import { CurriculumWorkspace } from "@/features/curriculum/curriculum-workspace";
import { ProgramsTermsSection } from "@/features/curriculum/programs-terms-section";

export default function CoursesSectionsPage() {
  return (
    <div className="space-y-5">
      <CurriculumWorkspace />
      <ProgramsTermsSection />
    </div>
  );
}
