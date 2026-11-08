/** Display labels shared by template generation and import header resolution. */
const columnLabels: Record<string, string> = {
  code: "Code",
  name: "Name",
  coordinator: "Coordinator",
  programCode: "Program Code",
  employmentType: "Employment Type",
  specialization: "Specialization",
  education: "Education",
  maxLoadUnits: "Max Load (Units)",
  maxLoadHours: "Max Load (Hours per Week)",
  status: "Status",
  description: "Description",
  yearLevel: "Year Level",
  category: "Category",
  units: "Units",
  contactHours: "Contact Hours",
  lectureHours: "Lecture Hours",
  labHours: "Laboratory Hours",
  curriculumVersion: "Curriculum Version",
  isCurrentCurriculum: "Current Curriculum?",
  studentCount: "Student Count",
  type: "Type",
  capacity: "Capacity",
  equipment: "Equipment",
  restrictions: "Restrictions",
  termCode: "Term Code",
  sectionCode: "Section Code",
  subjectCode: "Subject Code",
  component: "Component",
  meetingsPerWeek: "Meetings per Week",
  minutesPerMeeting: "Minutes per Meeting",
  meetingPattern: "Meeting Days",
  requiredRoomType: "Required Room Type",
  preassignedFacultyCode: "Preassigned Faculty Code",
  combinedClassGroup: "Combined Class Group",
  weekday: "Day of Week",
  startMin: "Start (Minutes After Midnight)",
  endMin: "End (Minutes After Midnight)",
  label: "Label",
  location: "Location",
  facultyCode: "Faculty Code",
  reason: "Reason",
  source: "Source",
  value: "Value",
  weight: "Weight",
  offeringCode: "Offering Code",
  roomCode: "Room Code",
};

const sheetLabels: Record<string, Record<string, string>> = {
  Programs: { code: "Program Code", name: "Program Name" },
  Faculty: { code: "Faculty Code", name: "Faculty Name" },
  Subjects: { code: "Subject Code", name: "Subject Name" },
  Sections: { code: "Section Code" },
  Rooms: { code: "Room Code", name: "Room Name", type: "Room Type" },
  Offerings: { code: "Offering Code" },
  FacultyPreferences: { type: "Preference Type", value: "Preference Value" },
};

export function workbookColumnLabel(sheet: string, key: string): string {
  return sheetLabels[sheet]?.[key] ?? columnLabels[key] ?? key;
}

/** Accept both readable headers and the original field names in older workbooks. */
export function workbookHeaderKeys(sheet: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const [key, label] of Object.entries(columnLabels)) {
    aliases.set(key.toLowerCase(), key);
    aliases.set(label.toLowerCase(), key);
  }
  // Sheet-specific labels take priority, e.g. Faculty Code identifies `code` on Faculty.
  for (const [key, label] of Object.entries(sheetLabels[sheet] ?? {})) {
    aliases.set(label.toLowerCase(), key);
  }
  return aliases;
}
