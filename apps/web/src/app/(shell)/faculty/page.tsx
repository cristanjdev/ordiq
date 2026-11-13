import type { Metadata } from "next";
import { FacultyWorkspace } from "@/features/faculty/faculty-workspace";

export const metadata: Metadata = { title: "Faculty" };

export default function FacultyPage() {
  return <FacultyWorkspace />;
}
