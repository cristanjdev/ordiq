import { MasterDataWorkspace } from "@/features/data/master-data-workspace";

export default function RoomsPage() {
  return (
    <MasterDataWorkspace
      initialDataset="rooms"
      title="Rooms & Laboratories"
      subtitle="Manage lecture rooms (≥40 seats) and engineering laboratories (≥30 seats), equipment, and availability."
    />
  );
}
