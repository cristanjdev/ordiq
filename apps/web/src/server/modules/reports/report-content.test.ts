import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { setAuditSinkForTests } from "../../platform/audit";
import { computeScheduleAnalytics } from "../analytics/analytics.service";
import { generateSmallFixture, loadFixtureIntoStore } from "../fixtures/fixture.generator";
import {
  getMasterDataState,
  resetMasterDataState,
  type ScheduleRecord,
} from "../master-data/master-data.store";
import { manilaDateTime, reportAcademicPeriod, REPORT_BUILDERS, type ReportContext } from "./report-content";
import { CANDIDATE_WATERMARK, generateScheduleReport, REPORT_TYPES } from "./reports.service";

const TERM = "AY2026-2027-S1";
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function schedule(): ScheduleRecord {
  const sched = [...getMasterDataState().schedules.values()].find((s) => s.termCode === TERM && s.entries.length > 0);
  if (!sched) throw new Error("fixture has no schedule");
  return sched;
}

function context(sched: ScheduleRecord, entityFilter?: string): ReportContext {
  return {
    state: getMasterDataState(),
    termCode: TERM,
    sched,
    analytics: computeScheduleAnalytics(TERM, sched.id),
    entityFilter,
    watermark: sched.status === "ACCEPTED" ? "" : CANDIDATE_WATERMARK,
  };
}

/** Minutes since midnight from "9:30 AM". */
function minutes(clock: string): number {
  const [, h, m, ap] = /^(\d+):(\d+) (AM|PM)/.exec(clock) ?? [];
  return ((Number(h) % 12) + (ap === "PM" ? 12 : 0)) * 60 + Number(m);
}

describe("report content", () => {
  it("uses formal academic periods and Philippine time, including date rollover", () => {
    expect(reportAcademicPeriod("2026-2027", 1)).toBe("Academic Year 2026–2027 · First Semester");
    expect(reportAcademicPeriod("2026-2027", 2)).toBe("Academic Year 2026–2027 · Second Semester");
    expect(manilaDateTime("2026-11-08T08:23:16.271Z")).toBe("November 8, 2026 at 4:23 PM (Philippine Time)");
    expect(manilaDateTime("2026-12-31T18:15:00Z")).toBe("January 1, 2027 at 2:15 AM (Philippine Time)");
  });

  beforeEach(async () => {
    resetMasterDataState();
    setAuditSinkForTests({ write: async (input) => ({ ...input, id: crypto.randomUUID(), createdAt: new Date() }) });
    await loadFixtureIntoStore(generateSmallFixture(), { actor: "dean" });
  });

  it("groups timetables by section with classes in day and time order and no raw offering codes", () => {
    const sched = schedule();
    const content = REPORT_BUILDERS.SECTION_SCHEDULE(context(sched));
    const headings = content.sections.map((s) => s.heading);
    expect(new Set(headings).size).toBe(headings.length);
    expect(content.sections.reduce((n, s) => n + s.rows.length, 0)).toBe(sched.entries.length);
    for (const section of content.sections) {
      const order = section.rows.map(([day = "", time = ""]) => DAYS.indexOf(day) * 1440 + minutes(time));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
    const text = JSON.stringify(content);
    expect(text).not.toMatch(/OFF-AY/);
    expect(text).not.toMatch(/\b0\d:\d\d [AP]M/); // "9:30 AM", not "09:30 AM"
  });

  it("limits a timetable to one faculty member when a filter is given", () => {
    const sched = schedule();
    const faculty = sched.entries[0]?.facultyCode ?? "";
    const content = REPORT_BUILDERS.FACULTY_SCHEDULE(context(sched, faculty));
    expect(content.sections).toHaveLength(1);
    expect(content.sheet.rows.every((r) => r[0] === faculty)).toBe(true);
  });

  it("compares candidates without archived schedules and lists every schedule's changes", () => {
    const sched = schedule();
    const state = getMasterDataState();
    state.schedules.set("archived-copy", { ...sched, id: "archived-copy", status: "ARCHIVED", candidateLabel: "Old accepted copy" });
    state.schedules.set(sched.id, {
      ...sched,
      changes: [
        {
          id: "c1",
          scheduleId: sched.id,
          actor: "dean",
          action: "ENTRY_EDITED",
          beforeJson: sched.entries[0],
          afterJson: { ...sched.entries[0], weekday: "FRIDAY", startMin: 900, endMin: 990 },
          createdAt: new Date().toISOString(),
        },
      ],
    });

    const comparison = REPORT_BUILDERS.CANDIDATE_COMPARISON(context(sched));
    expect(JSON.stringify(comparison.sections)).not.toContain("Old accepted copy");

    const history = REPORT_BUILDERS.REVISION_HISTORY(context(sched));
    expect(history.sheet.rows).toHaveLength(1);
    expect(history.sheet.rows[0]?.[3]).toBe("Class moved or reassigned");
    expect(history.sheet.rows[0]?.[6]).toMatch(/^Friday, 3:00 PM – 4:30 PM/);
  });

  it("separates conflicts to fix from approved exceptions", () => {
    const content = REPORT_BUILDERS.CONFLICTS_AND_EXCEPTIONS(context(schedule()));
    expect(content.sections.map((s) => s.heading?.replace(/ \(\d+\)$/, ""))).toEqual([
      "Needs fixing",
      "Waived with approval",
      "Classes not scheduled",
    ]);
    for (const row of content.sections[0]?.rows ?? []) expect(row[0]).toMatch(/^HC-\d\d · /);
  });

  it("exports every report, filtered and unfiltered, with readable headings", async () => {
    const sched = schedule();
    for (const reportType of REPORT_TYPES) {
      const report = await generateScheduleReport({ termCode: TERM, scheduleId: sched.id, reportType, format: "XLSX", actor: "dean" });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(report.buffer as unknown as ExcelJS.Buffer);
      const sheet = wb.worksheets[0];
      expect(String(sheet?.getCell(1, 1).value)).toMatch(/^ORDIQ — /);
      expect(String(sheet?.getCell(3, 1).value)).toContain("Academic Year 2026–2027 · First Semester");
      sheet?.getRow(5).eachCell((cell, column) => {
        expect(cell.alignment.horizontal).toBe(column === 1 ? "left" : "center");
      });
      sheet?.getRow(6).eachCell((cell, column) => {
        expect(cell.alignment.horizontal).toBe(column === 1 ? "left" : "center");
      });
    }
    const section = getMasterDataState().offerings.get(sched.entries[0]?.offeringCode ?? "")?.sectionCode ?? "";
    const pdf = await generateScheduleReport({ termCode: TERM, scheduleId: sched.id, reportType: "SECTION_SCHEDULE", format: "PDF", actor: "dean", entityFilter: section });
    expect(pdf.fileName).toContain(section.toLowerCase());
    expect(pdf.buffer.toString("latin1")).toContain(`(Section ${section})`);
  });
});
