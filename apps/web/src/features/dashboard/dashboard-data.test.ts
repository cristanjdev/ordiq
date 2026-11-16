import { describe, expect, it } from "vitest";
import {
  type DashboardMeeting,
  displayFacultyLabel,
  displayRoomLabel,
  filterMeetingsBySection,
  filterSlotMeetings,
  groupCellSubjects,
  groupMeetingsByWeekday,
  groupSubjectByTimeSlot,
  groupSubjectSchedules,
  meetingsForHourSlot,
} from "./dashboard-data";

const sampleMeetings: DashboardMeeting[] = [
  {
    id: "m1",
    offeringCode: "OFF-1",
    subjectCode: "MAMW 100",
    subjectName: "Mathematics in the Modern World",
    sectionCode: "BSCE-1A",
    component: "LECTURE",
    facultyCode: "FAC-1",
    facultyName: "Prof. Elena Reyes",
    roomCode: "CE-201",
    weekday: "MONDAY",
    startMin: 7 * 60,
    endMin: 8 * 60 + 30,
    hasConflict: false,
  },
  {
    id: "m1b",
    offeringCode: "OFF-1B",
    subjectCode: "MAMW 100",
    subjectName: "Mathematics in the Modern World",
    sectionCode: "G1A1",
    component: "LECTURE",
    facultyCode: "",
    facultyName: "",
    roomCode: "CET105",
    weekday: "MONDAY",
    startMin: 7 * 60,
    endMin: 8 * 60 + 30,
    hasConflict: true,
  },
  {
    id: "m2",
    offeringCode: "OFF-2",
    subjectCode: "COMP 111L",
    subjectName: "Computer Fundamentals Lab",
    sectionCode: "BSCpE-1A",
    component: "LAB",
    facultyCode: "FAC-2",
    facultyName: "Engr. Marco Cruz",
    roomCode: "LAB-302",
    weekday: "MONDAY",
    startMin: 7 * 60 + 30,
    endMin: 9 * 60,
    hasConflict: false,
  },
  {
    id: "m3",
    offeringCode: "OFF-3",
    subjectCode: "MAMW 100",
    subjectName: "Mathematics in the Modern World",
    sectionCode: "BSCE-1B",
    component: "LECTURE",
    facultyCode: "EXTERNAL",
    facultyName: "EXTERNAL",
    roomCode: "EXTERNAL",
    weekday: "WEDNESDAY",
    startMin: 8 * 60,
    endMin: 9 * 60 + 30,
    hasConflict: false,
  },
  {
    id: "m4",
    offeringCode: "OFF-4",
    subjectCode: "MATH 123",
    subjectName: "Calculus I",
    sectionCode: "BSCE-1A",
    component: "LECTURE",
    facultyCode: "FAC-1",
    facultyName: "Prof. Elena Reyes",
    roomCode: "CE-105",
    weekday: "TUESDAY",
    startMin: 7 * 60,
    endMin: 8 * 60,
    hasConflict: false,
  },
];

describe("dashboard slot helpers", () => {
  it("formats blank and external faculty/room labels cleanly", () => {
    expect(displayFacultyLabel("", "")).toBe("Unassigned");
    expect(displayFacultyLabel("EXTERNAL", "EXTERNAL")).toBe("External");
    expect(displayFacultyLabel("FAC-1", "Prof. Elena Reyes")).toBe("Prof. Elena Reyes");

    expect(displayRoomLabel("")).toBe("Unassigned");
    expect(displayRoomLabel("EXTERNAL")).toBe("External");
    expect(displayRoomLabel("CET105")).toBe("CET105");
  });

  it("filters meetings by section or returns all for ALL", () => {
    expect(filterMeetingsBySection(sampleMeetings, "ALL")).toHaveLength(5);
    expect(filterMeetingsBySection(sampleMeetings, "BSCE-1A").map((m) => m.id)).toEqual([
      "m1",
      "m4",
    ]);
  });

  it("groups meetings by weekday and starting hour bucket", () => {
    const monSeven = meetingsForHourSlot(sampleMeetings, "MONDAY", 7);
    expect(monSeven.map((m) => m.id)).toEqual(["m1", "m1b", "m2"]);

    const wedEight = meetingsForHourSlot(sampleMeetings, "WEDNESDAY", 8);
    expect(wedEight.map((m) => m.id)).toEqual(["m3"]);
  });

  it("deduplicates repeated subjects within a cell and propagates conflict state", () => {
    const monSeven = meetingsForHourSlot(sampleMeetings, "MONDAY", 7);
    const groups = groupCellSubjects(monSeven);

    expect(groups.map((g) => g.subjectCode)).toEqual(["MAMW 100", "COMP 111L"]);
    expect(groups[0]?.meetings.map((m) => m.id)).toEqual(["m1", "m1b"]);
    expect(groups[0]?.hasConflict).toBe(true);
    expect(groups[1]?.hasConflict).toBe(false);
  });

  it("groups meetings by weekday in Mon-Sat order", () => {
    const mamw = sampleMeetings.filter((m) => m.subjectCode === "MAMW 100");
    const grouped = groupMeetingsByWeekday(mamw);

    expect(grouped.map((g) => g.weekday)).toEqual(["MONDAY", "WEDNESDAY"]);
    expect(grouped[0]?.meetings.map((m) => m.id)).toEqual(["m1", "m1b"]);
    expect(grouped[1]?.meetings.map((m) => m.id)).toEqual(["m3"]);
  });

  it("filters slot meetings across subject, section, room, faculty, weekday, and time", () => {
    const monSeven = meetingsForHourSlot(sampleMeetings, "MONDAY", 7);

    expect(filterSlotMeetings(monSeven, "  ")).toHaveLength(3);
    expect(filterSlotMeetings(monSeven, "bsce-1a").map((m) => m.id)).toEqual(["m1"]);
    expect(filterSlotMeetings(monSeven, "unassigned").map((m) => m.id)).toEqual(["m1b"]);
    expect(filterSlotMeetings(monSeven, "LAB-302").map((m) => m.id)).toEqual(["m2"]);
    expect(filterSlotMeetings(monSeven, "marco").map((m) => m.id)).toEqual(["m2"]);
    expect(filterSlotMeetings(monSeven, "7:30 am").map((m) => m.id)).toEqual(["m2"]);
    expect(filterSlotMeetings(sampleMeetings, "wed").map((m) => m.id)).toEqual(["m3"]);
    expect(filterSlotMeetings(monSeven, "nonexistent")).toEqual([]);
  });

  it("merges same-section, same-time, same-room meetings across weekdays", () => {
    const wedPair: DashboardMeeting = {
      id: "m1b-wed",
      offeringCode: "OFF-1B",
      subjectCode: "MAMW 100",
      subjectName: "Mathematics in the Modern World",
      sectionCode: "G1A1",
      component: "LECTURE",
      facultyCode: "",
      facultyName: "",
      roomCode: "CET105",
      weekday: "WEDNESDAY",
      startMin: 7 * 60,
      endMin: 8 * 60 + 30,
      hasConflict: false,
    };
    const mamw = [...sampleMeetings.filter((m) => m.subjectCode === "MAMW 100"), wedPair];
    const rows = groupSubjectSchedules(mamw);

    expect(rows).toHaveLength(3);
    const g1a1 = rows.find((r) => r.sectionCode === "G1A1");
    expect(g1a1?.daysLabel).toBe("Monday, Wednesday");
    expect(g1a1?.whenLabel).toBe("Monday, Wednesday · 7:00 AM – 8:30 AM");
    expect(g1a1?.roomLabel).toBe("CET105");
    expect(g1a1?.facultyLabel).toBe("Unassigned");
    expect(g1a1?.hasConflict).toBe(true);
  });

  it("groups merged subject schedules chronologically by time slot", () => {
    const mamw = sampleMeetings.filter((m) => m.subjectCode === "MAMW 100");
    const slots = groupSubjectByTimeSlot(mamw);

    expect(slots).toHaveLength(2);
    expect(slots[0]?.whenLabel).toBe("Monday · 7:00 AM – 8:30 AM");
    expect(slots[0]?.sections.map((s) => s.sectionCode)).toEqual(["BSCE-1A", "G1A1"]);
    expect(slots[1]?.whenLabel).toBe("Wednesday · 8:00 AM – 9:30 AM");
    expect(slots[1]?.sections.map((s) => s.sectionCode)).toEqual(["BSCE-1B"]);
  });
});
