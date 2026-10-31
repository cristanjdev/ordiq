import { MasterDataWorkspace } from "@/features/data/master-data-workspace";

export default function CoursesSectionsPage() {
  return (
    <MasterDataWorkspace
      initialDataset="sections"
      title="Courses & Sections"
      subtitle="Manage subjects, section-level student counts (no individual student records), offerings, and external FixedBlocks."
    />
  );
}
