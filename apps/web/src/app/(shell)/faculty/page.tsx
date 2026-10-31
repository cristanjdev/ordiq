import { MasterDataWorkspace } from "@/features/data/master-data-workspace";

export default function FacultyPage() {
  return (
    <MasterDataWorkspace
      initialDataset="faculty"
      title="Faculty"
      subtitle="Manage the 44 MSEUF College of Engineering faculty records, specializations, employment types, teaching loads, and pseudonym aliases."
    />
  );
}
