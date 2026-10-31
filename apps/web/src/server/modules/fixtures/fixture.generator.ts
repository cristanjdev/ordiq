import type { EmploymentType, Weekday } from "@ordiq/contracts";
import type {
  FacultyAvailabilityInput,
  FacultyInput,
  FacultyPreferenceInput,
  FacultyQualificationInput,
  FixedBlockInput,
  OfferingInput,
  ProgramInput,
  RoomInput,
  SectionInput,
  SubjectInput,
  TermInput,
} from "../master-data/master-data.schema";
import {
  upsertFaculty,
  upsertFacultyAvailability,
  upsertFacultyPreference,
  upsertFacultyQualification,
  upsertFixedBlock,
  upsertOffering,
  upsertProgram,
  upsertRoom,
  upsertSection,
  upsertSubject,
  upsertTerm,
  type ActorContext,
} from "../master-data/master-data.service";
import {
  getMasterDataState,
  resetMasterDataState,
  type ScheduleEntryRecord,
  type ScheduleRecord,
} from "../master-data/master-data.store";

export interface PastScheduleRowInput {
  offeringCode: string;
  facultyCode: string;
  roomCode: string;
  weekday: Weekday;
  startMin: number;
  endMin: number;
}

export interface CollegeFixtureDataset {
  name: "small" | "medium";
  term: TermInput;
  programs: ProgramInput[];
  faculty: FacultyInput[];
  subjects: SubjectInput[];
  sections: SectionInput[];
  rooms: RoomInput[];
  offerings: OfferingInput[];
  fixedBlocks: FixedBlockInput[];
  facultyAvailability: FacultyAvailabilityInput[];
  facultyQualifications: FacultyQualificationInput[];
  facultyPreferences: FacultyPreferenceInput[];
  pastSchedule: PastScheduleRowInput[];
}

export const MSEUF_ENGINEERING_PROGRAMS: readonly ProgramInput[] = [
  {
    code: "CE",
    name: "BS Civil Engineering",
    coordinator: "Engr. Coordinator CE",
  },
  {
    code: "CPE",
    name: "BS Computer Engineering",
    coordinator: "Engr. Coordinator CpE",
  },
  {
    code: "EE",
    name: "BS Electrical Engineering",
    coordinator: "Engr. Coordinator EE",
  },
  {
    code: "ECE",
    name: "BS Electronics Engineering",
    coordinator: "Engr. Coordinator ECE",
  },
  {
    code: "GE",
    name: "BS Geodetic Engineering",
    coordinator: "Engr. Coordinator GE",
  },
  {
    code: "IE",
    name: "BS Industrial Engineering",
    coordinator: "Engr. Coordinator IE",
  },
  {
    code: "ME",
    name: "BS Mechanical Engineering",
    coordinator: "Engr. Coordinator ME",
  },
] as const;

const SPECIALIZATIONS_BY_PROGRAM: Record<string, string> = {
  CE: "Structural & Geotechnical Engineering",
  CPE: "Embedded Systems, Software & Computer Networks",
  EE: "Power Systems & Electrical Machines",
  ECE: "Communications, Microelectronics & Signal Processing",
  GE: "Surveying, GIS & Photogrammetry",
  IE: "Operations Research, Ergonomics & Quality Systems",
  ME: "Thermodynamics, Machine Design & HVAC",
};

/**
 * Generates the Medium synthetic fixture modeling the MSEUF College of Engineering:
 * - 7 engineering programs
 * - 44 faculty (12 FULL_TIME_PERMANENT, 18 FULL_TIME_NON_PERMANENT, 13 PART_TIME, 1 VISITING)
 * - 24 first- and second-year sections totaling exactly 903 students (section-level counts only)
 * - Lecture rooms >= 40 seats, laboratories >= 30 seats
 */
export function generateMediumCollegeFixture(): CollegeFixtureDataset {
  const term: TermInput = {
    code: "AY2026-2027-S1",
    academicYear: "2026-2027",
    semester: 1,
    status: "READY",
    slotSizeMin: 30,
    teachingDays: [
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
    ],
    dayStartMin: 450, // 07:30 AM
    dayEndMin: 1230, // 08:30 PM
  };

  const programs: ProgramInput[] = [...MSEUF_ENGINEERING_PROGRAMS];

  // Build 44 faculty: 12 FTP, 18 FTNP, 13 PT, 1 VISITING
  const employmentDistribution: EmploymentType[] = [
    ...Array<EmploymentType>(12).fill("FULL_TIME_PERMANENT"),
    ...Array<EmploymentType>(18).fill("FULL_TIME_NON_PERMANENT"),
    ...Array<EmploymentType>(13).fill("PART_TIME"),
    "VISITING",
  ];

  const faculty: FacultyInput[] = employmentDistribution.map(
    (employmentType, idx) => {
      const num = idx + 1;
      const code = `FAC-${String(num).padStart(3, "0")}`;
      const prog = programs[idx % programs.length] ?? programs[0] ?? {
        code: "CE",
        name: "BS Civil Engineering",
        coordinator: "Coordinator",
      };
      const isFullTime =
        employmentType === "FULL_TIME_PERMANENT" ||
        employmentType === "FULL_TIME_NON_PERMANENT";
      return {
        code,
        name: `Engr. Faculty Member ${String(num).padStart(2, "0")}`,
        programCode: prog.code,
        employmentType,
        specialization:
          SPECIALIZATIONS_BY_PROGRAM[prog.code] ?? "General Engineering",
        education: isFullTime
          ? `MS ${prog.name.replace("BS ", "")}`
          : `BS ${prog.name.replace("BS ", "")}`,
        maxLoadUnits: isFullTime ? 21 : employmentType === "PART_TIME" ? 12 : 9,
        maxLoadHours: isFullTime
          ? 24
          : employmentType === "PART_TIME"
            ? 15
            : 12,
        status: "ACTIVE",
      };
    },
  );

  // Build 24 sections across 1st and 2nd year whose studentCounts sum to 903
  // 21 sections * 38 = 798; 3 sections * 35 = 105; 798 + 105 = 903!
  const sections: SectionInput[] = [];
  for (let i = 0; i < 24; i++) {
    const prog = programs[i % programs.length] ?? {
      code: "CE",
      name: "BS Civil Engineering",
      coordinator: "Coordinator",
    };
    const yearLevel = i < 14 ? 1 : 2;
    const sectionLetter = String.fromCharCode(65 + Math.floor(i / 7));
    const code = `${prog.code}-${yearLevel}${sectionLetter}`;
    const studentCount = i < 21 ? 38 : 35;
    sections.push({
      code,
      programCode: prog.code,
      yearLevel,
      studentCount,
    });
  }

  // Rooms: 10 Lecture rooms (capacity >= 40) and 8 Lab rooms (capacity >= 30)
  const rooms: RoomInput[] = [];
  for (let i = 1; i <= 10; i++) {
    rooms.push({
      code: `EN-LEC-${String(i).padStart(2, "0")}`,
      name: `Engineering Lecture Room ${200 + i}`,
      type: "LECTURE",
      capacity: 40 + (i % 3) * 2, // 40, 42, 44 (>= 40)
      equipment: ["Projector", "Whiteboard"],
      restrictions: "",
      status: "ACTIVE",
    });
  }
  for (let i = 1; i <= 8; i++) {
    const prog = programs[(i - 1) % programs.length] ?? {
      code: "CE",
      name: "BS Civil Engineering",
      coordinator: "Coordinator",
    };
    rooms.push({
      code: `EN-LAB-${String(i).padStart(2, "0")}`,
      name: `${prog.code} Laboratory ${100 + i}`,
      type: "LAB",
      capacity: 38 + (i % 2) * 2, // 38..40 (>= 30 and fits 38-student sections)
      equipment: ["Laboratory Workstations", "Safety Kit"],
      restrictions: `${prog.code} / General Engineering Lab`,
      status: "ACTIVE",
    });
  }

  // Subjects: 2 per program (Year 1 Lecture + Year 2 Lecture/Lab)
  const subjects: SubjectInput[] = [];
  for (const prog of programs) {
    subjects.push({
      code: `${prog.code}101`,
      name: `${prog.name.replace("BS ", "")} Fundamentals`,
      description: `Core introductory course for ${prog.name}. Covers ${SPECIALIZATIONS_BY_PROGRAM[prog.code]}.`,
      programCode: prog.code,
      yearLevel: 1,
      category: "MAJOR",
      units: 3,
      contactHours: 3,
      lectureHours: 3,
      labHours: 0,
      curriculumVersion: "2024",
      isCurrentCurriculum: true,
    });
    subjects.push({
      code: `${prog.code}201L`,
      name: `${prog.name.replace("BS ", "")} Applied Laboratory`,
      description: `Laboratory course for ${prog.name}. Covers ${SPECIALIZATIONS_BY_PROGRAM[prog.code]}.`,
      programCode: prog.code,
      yearLevel: 2,
      category: "MAJOR",
      units: 2,
      contactHours: 3,
      lectureHours: 0,
      labHours: 3,
      curriculumVersion: "2024",
      isCurrentCurriculum: true,
    });
  }

  // Qualifications: connect each faculty member to their program's subjects
  const facultyQualifications: FacultyQualificationInput[] = [];
  for (const fac of faculty) {
    for (const subj of subjects) {
      if (subj.programCode === fac.programCode) {
        facultyQualifications.push({
          facultyCode: fac.code,
          subjectCode: subj.code,
          source: "DECLARED",
        });
      }
    }
  }

  // Availability: Monday–Saturday 7:30 AM (450) to 5:30 PM (1050)
  const weekdays: Weekday[] = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  const facultyAvailability: FacultyAvailabilityInput[] = [];
  for (const fac of faculty) {
    for (const day of weekdays) {
      facultyAvailability.push({
        facultyCode: fac.code,
        termCode: term.code,
        weekday: day,
        startMin: 450,
        endMin: 1050,
        status: "AVAILABLE",
        reason: "Regular availability",
      });
    }
  }

  // Preferences: sample survey preferences
  const facultyPreferences: FacultyPreferenceInput[] = faculty
    .slice(0, 14)
    .map((fac, idx) => ({
      facultyCode: fac.code,
      termCode: term.code,
      type: idx % 2 === 0 ? "AVOID_DAY" : "PREFERRED_TIME_WINDOW",
      value: idx % 2 === 0 ? "SATURDAY" : "07:30-12:00",
      weight: 1.0,
      source: "SURVEY",
    }));

  // Offerings & FixedBlocks for each section
  const offerings: OfferingInput[] = [];
  const fixedBlocks: FixedBlockInput[] = [];
  const pastSchedule: PastScheduleRowInput[] = [];

  sections.forEach((sec, idx) => {
    const subjCode =
      sec.yearLevel === 1 ? `${sec.programCode}101` : `${sec.programCode}201L`;
    const isLab = sec.yearLevel === 2;
    const offCode = `OFF-${term.code}-${sec.code}-${subjCode}`;
    const progFacs = faculty.filter((f) => f.programCode === sec.programCode);
    const matchingFac =
      progFacs[Math.floor(idx / 7) % Math.max(1, progFacs.length)] ??
      faculty[0];
    if (!matchingFac) return;

    offerings.push({
      code: offCode,
      termCode: term.code,
      sectionCode: sec.code,
      subjectCode: subjCode,
      component: isLab ? "LAB" : "LECTURE",
      meetingsPerWeek: 2,
      minutesPerMeeting: 90,
      meetingPattern: idx % 2 === 0 ? "MWF" : "TTH",
      requiredRoomType: isLab ? "LAB" : "LECTURE",
      preassignedFacultyCode: matchingFac.code,
      combinedClassGroup: null,
    });

    // External FixedBlock (PATHFIT / GenEd outside college control, D-23)
    fixedBlocks.push({
      termCode: term.code,
      sectionCode: sec.code,
      weekday: "FRIDAY",
      startMin: 930, // 3:30 PM
      endMin: 1050, // 5:30 PM
      label: sec.yearLevel === 1 ? "PATHFIT 1" : "GEC Readings in Phil. History",
      location: "University Gymnasium / CAS Building",
    });

    const roomPool = rooms.filter(
      (r) => r.type === (isLab ? "LAB" : "LECTURE"),
    );
    const chosenRoom = roomPool[idx % roomPool.length] ?? roomPool[0];
    if (!chosenRoom) return;
    const dayPair: [Weekday, Weekday] =
      idx % 2 === 0 ? ["MONDAY", "WEDNESDAY"] : ["TUESDAY", "THURSDAY"];
    const slotOffset = (idx % 4) * 90;
    const startMin = 450 + slotOffset; // 450, 540, 630, 720
    const endMin = startMin + 90;

    for (const day of dayPair) {
      pastSchedule.push({
        offeringCode: offCode,
        facultyCode: matchingFac.code,
        roomCode: chosenRoom.code,
        weekday: day,
        startMin,
        endMin,
      });
    }
  });

  return {
    name: "medium",
    term,
    programs,
    faculty,
    subjects,
    sections,
    rooms,
    offerings,
    fixedBlocks,
    facultyAvailability,
    facultyQualifications,
    facultyPreferences,
    pastSchedule,
  };
}

export function generateSmallFixture(): CollegeFixtureDataset {
  const medium = generateMediumCollegeFixture();
  const programs = medium.programs.slice(0, 2); // CE, CPE
  const progCodes = new Set(programs.map((p) => p.code));
  const faculty = [
    ...medium.faculty.filter((f) => f.programCode === "CE").slice(0, 3),
    ...medium.faculty.filter((f) => f.programCode === "CPE").slice(0, 3),
  ];
  const facCodes = new Set(faculty.map((f) => f.code));
  const subjects = medium.subjects.filter(
    (s) => s.programCode && progCodes.has(s.programCode),
  );
  const subjCodes = new Set(subjects.map((s) => s.code));
  const sections = [
    ...medium.sections.filter((sec) => sec.programCode === "CE").slice(0, 2),
    ...medium.sections.filter((sec) => sec.programCode === "CPE").slice(0, 2),
  ];
  const secCodes = new Set(sections.map((s) => s.code));
  const rooms = [
    ...medium.rooms.filter((r) => r.type === "LECTURE").slice(0, 2),
    ...medium.rooms.filter((r) => r.type === "LAB").slice(0, 2),
  ];
  const lecRooms = rooms.filter((r) => r.type === "LECTURE");
  const labRooms = rooms.filter((r) => r.type === "LAB");
  const offerings = medium.offerings
    .filter((o) => secCodes.has(o.sectionCode))
    .map((o) => ({
      ...o,
      preassignedFacultyCode:
        o.preassignedFacultyCode && facCodes.has(o.preassignedFacultyCode)
          ? o.preassignedFacultyCode
          : (faculty[0]?.code ?? null),
    }));

  const pastSchedule: PastScheduleRowInput[] = [];
  offerings.forEach((off, offIdx) => {
    const isLab = off.requiredRoomType === "LAB";
    const pool = isLab ? labRooms : lecRooms;
    const roomCode = pool[offIdx % pool.length]?.code ?? rooms[0]?.code ?? "EN-LEC-01";
    const facCode =
      off.preassignedFacultyCode ??
      faculty.find((f) => f.programCode === off.subjectCode.slice(0, 2))?.code ??
      faculty[0]?.code ??
      "FAC-001";
    const days: [Weekday, Weekday] =
      off.meetingPattern === "TTH"
        ? ["TUESDAY", "THURSDAY"]
        : ["MONDAY", "WEDNESDAY"];
    const startMin = 450 + offIdx * 90;
    const endMin = startMin + off.minutesPerMeeting;
    for (const day of days) {
      pastSchedule.push({
        offeringCode: off.code,
        facultyCode: facCode,
        roomCode,
        weekday: day,
        startMin,
        endMin,
      });
    }
  });

  return {
    name: "small",
    term: medium.term,
    programs,
    faculty,
    subjects,
    sections,
    rooms,
    offerings,
    fixedBlocks: medium.fixedBlocks.filter((b) => secCodes.has(b.sectionCode)),
    facultyAvailability: medium.facultyAvailability.filter((a) =>
      facCodes.has(a.facultyCode),
    ),
    facultyQualifications: medium.facultyQualifications.filter(
      (q) => facCodes.has(q.facultyCode) && subjCodes.has(q.subjectCode),
    ),
    facultyPreferences: medium.facultyPreferences.filter((p) =>
      facCodes.has(p.facultyCode),
    ),
    pastSchedule,
  };
}

export async function loadFixtureIntoStore(
  fixture: CollegeFixtureDataset,
  ctx: ActorContext = { actor: "SYSTEM_FIXTURE" },
): Promise<void> {
  resetMasterDataState();
  await upsertTerm(fixture.term, ctx);

  for (const p of fixture.programs) {
    await upsertProgram(p, ctx);
  }
  for (const f of fixture.faculty) {
    await upsertFaculty(f, ctx);
  }
  for (const s of fixture.subjects) {
    await upsertSubject(s, ctx);
  }
  for (const sec of fixture.sections) {
    await upsertSection(sec, ctx);
  }
  for (const r of fixture.rooms) {
    await upsertRoom(r, ctx);
  }
  for (const q of fixture.facultyQualifications) {
    await upsertFacultyQualification(q, ctx);
  }
  for (const a of fixture.facultyAvailability) {
    await upsertFacultyAvailability(a, ctx);
  }
  for (const pref of fixture.facultyPreferences) {
    await upsertFacultyPreference(pref, ctx);
  }
  for (const off of fixture.offerings) {
    await upsertOffering(off, ctx);
  }
  for (const fb of fixture.fixedBlocks) {
    await upsertFixedBlock(fb, ctx);
  }

  if (fixture.pastSchedule.length > 0) {
    const store = getMasterDataState();
    const entries: ScheduleEntryRecord[] = fixture.pastSchedule.map((row) => ({
      id: crypto.randomUUID(),
      offeringCode: row.offeringCode,
      facultyCode: row.facultyCode,
      roomCode: row.roomCode,
      weekday: row.weekday,
      startMin: row.startMin,
      endMin: row.endMin,
      pinned: false,
    }));
    const importedSchedule: ScheduleRecord = {
      id: crypto.randomUUID(),
      termCode: fixture.term.code,
      candidateLabel: "1st Sem A.Y. 2026-2027 Manual Baseline (Imported)",
      status: "CANDIDATE",
      source: "IMPORTED",
      recheckNeeded: false,
      version: 1,
      qualityScore: null,
      entries,
    };
    store.schedules.set(importedSchedule.id, importedSchedule);
  }
}

