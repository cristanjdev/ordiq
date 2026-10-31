import { MasterDataWorkspace } from "@/features/data/master-data-workspace";

export default function RulesAndPreferencesPage() {
  return (
    <MasterDataWorkspace
      initialDataset="fixedBlocks"
      title="Rules, Fixed Blocks & Preferences"
      subtitle="Configure locked university blocks (PATHFIT, GenEd), faculty availability, and scheduling rules."
    />
  );
}


