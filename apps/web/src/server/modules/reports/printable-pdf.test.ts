import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPrintablePdfBuffer } from "./printable-pdf";

describe("printable PDF reports", () => {
  it("fits all schedule columns and paginates every record with repeated headers", () => {
    const pdf = buildPrintablePdfBuffer({
      title: "Class Schedule per Section",
      subtitle:
        "Academic Year 2026–2027 · First Semester\nSchedule: Candidate A — Balanced\nDate Generated: November 8, 2026 at 4:23 PM (Philippine Time)",
      watermark: "",
      headers: [
        "Section",
        "Offering",
        "Subject",
        "Component",
        "Day",
        "Start",
        "End",
        "Room",
        "Faculty",
      ],
      rows: Array.from({ length: 100 }, (_, index) => [
        `ROW-${String(index).padStart(3, "0")}`,
        `OFF-AY2026-2027-S1-CE-1A-CE101-${index}`,
        "CE101",
        index % 2 ? "Laboratory" : "Lecture",
        "Wednesday",
        "09:30 AM",
        "11:00 AM",
        "EN-LEC-02",
        "Engr. José María Dela Cruz-Santos",
      ]),
    });
    const source = pdf.toString("ascii");
    const pageCount = (source.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThan(1);
    expect(source).toContain("/MediaBox [0 0 842 595]");
    for (let index = 0; index < 100; index++) {
      expect(source).toContain(`ROW-${String(index).padStart(3, "0")}`);
    }
    expect(source.match(/\(Section\)/g)).toHaveLength(pageCount);
    expect(source).toContain(`Page ${pageCount} of ${pageCount}`);
    expect(source).toContain("Jos\\351");
    if (process.env.PDF_PREVIEW_DIR) {
      mkdirSync(process.env.PDF_PREVIEW_DIR, { recursive: true });
      writeFileSync(path.join(process.env.PDF_PREVIEW_DIR, "section-schedule.pdf"), pdf);
    }
  });

  it("continues oversized cells across pages without losing the last lines", () => {
    const pdf = buildPrintablePdfBuffer({
      title: "Validation and Preferences",
      subtitle: "Term: AY2026-2027-S1",
      watermark: "CANDIDATE SCHEDULE - NOT OFFICIAL",
      headers: ["Category", "Code", "Entity / Faculty", "Details"],
      rows: [["Validation", "HC-06", "FAC-001", "Long explanation\n".repeat(180) + "FINALDETAIL"]],
    });
    const source = pdf.toString("ascii");
    expect(source.match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
    expect(source).toContain("FINALDETAIL");
    expect(source).toContain("/MediaBox [0 0 595 842]");
    if (process.env.PDF_PREVIEW_DIR)
      writeFileSync(path.join(process.env.PDF_PREVIEW_DIR, "long-details.pdf"), pdf);
  });

  it("renders an empty report as one labelled page", () => {
    const pdf = buildPrintablePdfBuffer({
      title: "ISO/IEC 25012 Data Validation & Unmet Preferences",
      subtitle: "Academic Year 2026–2027 · First Semester\nSchedule: Candidate A — Balanced\nDate Generated: November 8, 2026 at 4:23 PM (Philippine Time)",
      watermark: "CANDIDATE SCHEDULE",
      summary: [
        { label: "Completeness", value: "100%" },
        { label: "Accuracy", value: "100%" },
        { label: "Consistency", value: "100%" },
        { label: "Currentness", value: "100%" },
        { label: "Readiness issues", value: "0" },
        { label: "Unmet preferences", value: "6" },
      ],
      headers: ["Metric", "Value", "Notes"],
      rows: [],
    });
    const source = pdf.toString("ascii");
    expect(source.match(/\/Type \/Page\b/g)).toHaveLength(1);
    expect(source).toContain("No records for this report.");
    expect(source).toContain("Page 1 of 1");
    expect(source).toContain("/MediaBox [0 0 842 595]");
    const summaryLabels = [...source.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm \((Completeness|Accuracy|Consistency|Currentness|Readiness issues|Unmet preferences)\)/g)];
    expect(summaryLabels).toHaveLength(6);
    expect(new Set(summaryLabels.map((match) => match[1])).size).toBe(1);
    const metadataLines = source.split("\n").filter((line) => line.includes("Date Generated:"));
    expect(metadataLines).toHaveLength(1);
    expect(metadataLines[0]).toContain("Academic Year");
    expect(metadataLines[0]).toContain("Schedule:");
    if (process.env.PDF_PREVIEW_DIR)
      writeFileSync(path.join(process.env.PDF_PREVIEW_DIR, "empty-summary.pdf"), pdf);
  });
});
