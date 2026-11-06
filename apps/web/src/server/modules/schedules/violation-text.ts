import type { EngineValidationResponse } from "@ordiq/contracts";
import { roomTypeLabel, titleCase } from "@/lib/display-labels";
import type { MasterDataState, ScheduleRecord } from "../master-data/master-data.store";

type Violation = EngineValidationResponse["violations"][number];

/**
 * Plain-language description of a validator finding for the Dean. The
 * validator's own message stays in the report for the record; this sentence
 * is built from the violation's structured fields and master-data names.
 */
export function describeViolation(
  v: Violation,
  state: MasterDataState,
  entries: ReadonlyArray<{ id: string; weekday: string; startMin: number; endMin: number }> = [],
): string {
  const facultyCodes = v.faculty_codes ?? [];
  const roomCodes = v.room_codes ?? [];
  const sectionCodes = v.section_codes ?? [];
  const offeringCodes = v.offering_codes ?? [];
  const faculty = (code?: string) => (code ? (state.faculty.get(code)?.name ?? code) : "A faculty member");
  const room = (code?: string) => {
    const r = code ? state.rooms.get(code) : undefined;
    return r ? `${r.code}${r.name && r.name !== r.code ? ` (${r.name})` : ""}` : (code ?? "a room");
  };
  const cls = (offeringCode?: string) => {
    const off = offeringCode ? state.offerings.get(offeringCode) : undefined;
    if (!off) return offeringCode ?? "a class";
    return `${off.subjectCode}${off.component === "LAB" ? " lab" : ""} of section ${off.sectionCode}`;
  };
  // Some findings carry only the entry id; take the day and time from it.
  const entry = entries.find((e) => e.id === v.entry_ids?.[0]);
  const weekday = v.weekday ?? entry?.weekday;
  const start = v.start_min ?? entry?.startMin;
  const end = v.end_min ?? entry?.endMin;
  const when = () => {
    if (!weekday) return "";
    const day = titleCase(weekday);
    if (start == null || end == null) return ` on ${day}`;
    return ` on ${day}, ${clock(start)} – ${clock(end)}`;
  };
  const [o1, o2] = offeringCodes;
  const twoClasses = o2 ? `${cls(o1)} and ${cls(o2)}` : cls(o1);

  switch (v.code) {
    case "HC-01":
      return `${faculty(facultyCodes[0])} is scheduled to teach two classes at the same time${when()}: ${twoClasses}.`;
    case "HC-02":
      return `Room ${room(roomCodes[0])} has two classes at the same time${when()}: ${twoClasses}.`;
    case "HC-03":
      return `Section ${sectionCodes[0] ?? ""} has two classes at the same time${when()}: ${twoClasses}.`;
    case "HC-04": {
      const r = state.rooms.get(roomCodes[0] ?? "");
      const sec = state.sections.get(sectionCodes[0] ?? "");
      if (r && sec) {
        return `Room ${room(r.code)} seats ${r.capacity}, but section ${sec.code} has ${sec.studentCount} students (${cls(o1)}${when()}).`;
      }
      return `The room for ${cls(o1)} is too small for the section${when()}.`;
    }
    case "HC-05": {
      const off = state.offerings.get(o1 ?? "");
      const r = state.rooms.get(roomCodes[0] ?? "");
      if (off && r) {
        return `${capitalize(cls(o1))} needs a ${roomTypeLabel(off.requiredRoomType).toLowerCase()}, but it is in ${room(r.code)}, a ${roomTypeLabel(r.type).toLowerCase()}${when()}.`;
      }
      return `${capitalize(cls(o1))} is in the wrong type of room${when()}.`;
    }
    case "HC-06":
      return `${faculty(facultyCodes[0])} is not available${when()}, but is scheduled to teach ${cls(o1)}.`;
    case "HC-07": {
      const f = state.faculty.get(facultyCodes[0] ?? "");
      return f
        ? `${f.name} is assigned more than the maximum teaching load of ${f.maxLoadUnits} units / ${f.maxLoadHours} hours a week.`
        : `${faculty(facultyCodes[0])} is assigned more than the maximum teaching load.`;
    }
    case "HC-08":
      return `${capitalize(cls(o1))} does not have all of its weekly meetings scheduled.`;
    case "HC-09": {
      const off = state.offerings.get(o1 ?? "");
      const subject = off ? state.subjects.get(off.subjectCode) : undefined;
      const subjectText = subject ? `${subject.code} (${subject.name})` : (off?.subjectCode ?? "this subject");
      return `${faculty(facultyCodes[0])} is not qualified to teach ${subjectText} for section ${off?.sectionCode ?? ""}${when()}.`;
    }
    case "HC-10": {
      const r = state.rooms.get(roomCodes[0] ?? "");
      if (r && r.status !== "ACTIVE") {
        const why = r.status === "MAINTENANCE" ? "under maintenance" : "marked inactive";
        return `Room ${room(r.code)} is ${why}, but ${cls(o1)} is scheduled there${when()}.`;
      }
      return `Room ${room(roomCodes[0])} is not available${when()}, but ${cls(o1)} is scheduled there.`;
    }
    case "HC-11":
      return `${capitalize(cls(o1))}${when()} is outside the teaching hours or overlaps an official break.`;
    case "HC-12":
      return `${capitalize(cls(o1))}${when()} goes against an approved Dean directive.`;
    case "HC-13":
      return `${capitalize(cls(o1))}${when()} does not have the required class length or meeting days.`;
    case "HC-14":
      return `${capitalize(cls(o1))}${when()} falls on a calendar or room maintenance restriction.`;
    case "HC-15":
      return `${capitalize(cls(o1))}${when()} overlaps a fixed block of section ${sectionCodes[0] ?? ""} (e.g. NSTP or PATHFit).`;
    default:
      return v.message;
  }
}

function clock(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The schedule as sent to the browser, each violation with a `description`. */
export function withViolationDescriptions(sched: ScheduleRecord, state: MasterDataState) {
  const report = sched.validationReport;
  if (!report) return sched;
  return {
    ...sched,
    validationReport: {
      ...report,
      violations: report.violations.map((v) => ({
        ...v,
        description: describeViolation(v, state, sched.entries),
      })),
    },
  };
}
