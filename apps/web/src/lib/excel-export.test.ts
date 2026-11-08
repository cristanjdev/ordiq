import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbookBuffer, parseWorkbookBuffer } from "@/server/modules/imports/imports.service";
import { createExcelExportBuffer } from "./excel-export";

describe("Excel downloads", () => {
  it("preserves data types and special characters and fits long, multiline text", async () => {
    const longText = "Engineering laboratory requirements ".repeat(12);
    const buffer = await createExcelExportBuffer({
      fileName: "rooms.xlsx",
      sheetName: "Rooms",
      headers: ["Code", "Name", "Capacity", "Notes"],
      rows: [
        ["001", 'José, "Laboratory" & 設備', 0, longText],
        ["002", "Room", 35, "First line\nSecond line\nThird line"],
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("Missing exported worksheet");
    expect(sheet.getCell("A2").value).toBe("001");
    expect(sheet.getCell("B2").value).toBe('José, "Laboratory" & 設備');
    expect(sheet.getCell("C2").value).toBe(0);
    expect(sheet.getCell("D2").value).toBe(longText);
    expect(sheet.getColumn(2).width).toBeGreaterThan(sheet.getColumn(1).width ?? 0);
    expect(sheet.getColumn(4).width).toBe(64);
    expect(sheet.getRow(2).height).toBeGreaterThan(24);
    expect(sheet.getRow(3).height).toBeGreaterThanOrEqual(55);
    expect(sheet.getCell("D2").alignment.wrapText).toBe(true);
    expect(sheet.getCell("A1").font.color?.argb).toBe("FFFFFFFF");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:D3");
  });

  it("styles every import sheet, including empty templates, without breaking import headers", async () => {
    const payload = {
      termCode: "AY2026-2027-S1",
      programs: [
        { code: "BSCE", name: "Bachelor of Science in Civil Engineering", coordinator: "José" },
      ],
    };
    const buffer = await buildWorkbookBuffer(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets).toHaveLength(11);
    for (const sheet of workbook.worksheets) {
      expect(sheet.getCell("A1").value).toBeTruthy();
      sheet.getRow(1).eachCell((cell) => {
        expect(cell.text).toMatch(/^[A-Z]/);
        expect(cell.text).not.toMatch(/[a-z][A-Z]/);
      });
      expect(sheet.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FF7A121B" } });
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
    }
    const parsed = await parseWorkbookBuffer(buffer, payload.termCode);
    expect(parsed.programs).toEqual(payload.programs);
    expect(workbook.getWorksheet("Programs")?.getColumn(2).width).toBeGreaterThan(22);
  });

  it("maps readable headers back to import fields without confusing entity codes or types", async () => {
    const payload = {
      termCode: "AY2026-2027-S1",
      faculty: [
        {
          code: "FAC-001",
          name: "José",
          programCode: "CE",
          employmentType: "PART_TIME",
          specialization: "Structures",
          education: "MS",
          maxLoadUnits: 12,
          maxLoadHours: 0,
          status: "ACTIVE",
        },
      ],
      rooms: [
        {
          code: "R-001",
          name: "Laboratory",
          type: "LAB",
          capacity: 30,
          equipment: "Computers",
          restrictions: "None",
          status: "ACTIVE",
        },
      ],
      subjects: [
        {
          code: "CE101",
          name: "Structures",
          description: "Introduction",
          programCode: "CE",
          yearLevel: 1,
          category: "MAJOR",
          units: 3,
          contactHours: 3,
          lectureHours: 3,
          labHours: 0,
          curriculumVersion: "2026",
          isCurrentCurriculum: false,
        },
      ],
      facultyPreferences: [
        {
          facultyCode: "FAC-001",
          termCode: "AY2026-2027-S1",
          type: "PREFERRED_DAY",
          value: "MONDAY",
          weight: 0,
          source: "DEAN",
        },
      ],
    };
    const buffer = await buildWorkbookBuffer(payload);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    expect(workbook.getWorksheet("Faculty")?.getRow(1).values).toEqual([
      undefined,
      "Faculty Code",
      "Faculty Name",
      "Program Code",
      "Employment Type",
      "Specialization",
      "Education",
      "Max Load (Units)",
      "Max Load (Hours per Week)",
      "Status",
    ]);
    const parsed = await parseWorkbookBuffer(buffer, payload.termCode);
    expect(parsed).toMatchObject(payload);
  });

  it("still imports original headers and supports reordered, mixed old and readable headers", async () => {
    const workbook = new ExcelJS.Workbook();
    const faculty = workbook.addWorksheet("Faculty");
    faculty.addRow(["name", "code", "programCode", "maxLoadUnits"]);
    faculty.addRow(["José", "FAC-001", "CE", 12]);
    const preferences = workbook.addWorksheet("FacultyPreferences");
    preferences.addRow(["Preference Value", "facultyCode", "Preference Type", "weight"]);
    preferences.addRow(["MONDAY", "FAC-001", "PREFERRED_DAY", 0]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseWorkbookBuffer(buffer);
    expect(parsed.faculty).toEqual([
      { name: "José", code: "FAC-001", programCode: "CE", maxLoadUnits: 12 },
    ]);
    expect(parsed.facultyPreferences).toEqual([
      { value: "MONDAY", facultyCode: "FAC-001", type: "PREFERRED_DAY", weight: 0 },
    ]);
  });
});
