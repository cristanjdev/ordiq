import { describe, expect, it } from "vitest";
import { createEmptyMasterDataState } from "../master-data/master-data.store";
import { describeViolation } from "./violation-text";

function fixtureState() {
  const state = createEmptyMasterDataState();
  state.faculty.set("FAC-004", { code: "FAC-004", name: "Engr. Ana Reyes", maxLoadUnits: 24, maxLoadHours: 30 } as never);
  state.faculty.set("FAC-019", { code: "FAC-019", name: "Engr. Ben Cruz" } as never);
  state.subjects.set("GE201L", { code: "GE201L", name: "Engineering Drawing Lab" } as never);
  state.sections.set("GE-2C", { code: "GE-2C", studentCount: 46 } as never);
  state.rooms.set("EN-LAB-01", { code: "EN-LAB-01", name: "Engineering Lab 1", type: "LAB", capacity: 40, status: "MAINTENANCE" } as never);
  state.offerings.set("OFF-1", { code: "OFF-1", subjectCode: "ECE101", sectionCode: "ECE-1A", component: "LECTURE" } as never);
  state.offerings.set("OFF-2", { code: "OFF-2", subjectCode: "GE201L", sectionCode: "GE-2C", component: "LAB", requiredRoomType: "LAB" } as never);
  return state;
}

const base = { message: "raw", waivable: true, waived: false, entry_ids: [], offering_codes: [], faculty_codes: [], room_codes: [], section_codes: [] };

describe("describeViolation", () => {
  const state = fixtureState();

  it("names the faculty member, day and clock time instead of codes and minutes", () => {
    const text = describeViolation(
      { ...base, code: "HC-06", offering_codes: ["OFF-1"], faculty_codes: ["FAC-004"], weekday: "TUESDAY", start_min: 900, end_min: 990 } as never,
      state,
    );
    expect(text).toBe("Engr. Ana Reyes is not available on Tuesday, 3:00 PM – 4:30 PM, but is scheduled to teach ECE101 of section ECE-1A.");
  });

  it("explains a missing qualification with the subject title", () => {
    const text = describeViolation(
      { ...base, code: "HC-09", offering_codes: ["OFF-2"], faculty_codes: ["FAC-019"], section_codes: ["GE-2C"], weekday: "MONDAY" } as never,
      state,
    );
    expect(text).toBe("Engr. Ben Cruz is not qualified to teach GE201L (Engineering Drawing Lab) for section GE-2C on Monday.");
  });

  it("says a room is under maintenance and takes the time from the schedule entry", () => {
    const text = describeViolation(
      { ...base, code: "HC-10", entry_ids: ["e1"], offering_codes: ["OFF-2"], room_codes: ["EN-LAB-01"] } as never,
      state,
      [{ id: "e1", weekday: "FRIDAY", startMin: 480, endMin: 660 }],
    );
    expect(text).toBe(
      "Room EN-LAB-01 (Engineering Lab 1) is under maintenance, but GE201L lab of section GE-2C is scheduled there on Friday, 8:00 AM – 11:00 AM.",
    );
  });

  it("compares room seats with the section size", () => {
    const text = describeViolation(
      { ...base, code: "HC-04", offering_codes: ["OFF-2"], room_codes: ["EN-LAB-01"], section_codes: ["GE-2C"] } as never,
      state,
    );
    expect(text).toBe("Room EN-LAB-01 (Engineering Lab 1) seats 40, but section GE-2C has 46 students (GE201L lab of section GE-2C).");
  });

  it("falls back to the validator message for unknown codes", () => {
    expect(describeViolation({ ...base, code: "HC-99" } as never, state)).toBe("raw");
  });
});
