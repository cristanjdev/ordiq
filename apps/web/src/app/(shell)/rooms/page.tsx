import type { Metadata } from "next";
import { RoomsWorkspace } from "@/features/rooms/rooms-workspace";

export const metadata: Metadata = { title: "Rooms & Laboratories" };

export default function RoomsPage() {
  return <RoomsWorkspace />;
}
