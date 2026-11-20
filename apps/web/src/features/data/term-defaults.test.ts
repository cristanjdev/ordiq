import { describe, expect, it } from "vitest";
import { parseSubjectDepartment } from "@/lib/display-labels";
import { latestTerm, nextTermValues } from "./term-defaults";

describe("nextTermValues", () => {
  it("follows a 1st semester with the 2nd semester of the same year", () => {
    const v = nextTermValues({ code: "AY2026-2027-S1", academicYear: "2026-2027", semester: 1 });
    expect(v).toMatchObject({ code: "AY2026-2027-S2", academicYear: "2026-2027", semester: "2", status: "DRAFT" });
  });

  it("follows a 2nd semester with the 1st semester of the next year and keeps the teaching hours", () => {
    const v = nextTermValues({
      code: "AY2026-2027-S2",
      academicYear: "2026-2027",
      semester: 2,
      dayStartMin: 420,
      dayEndMin: 1200,
      teachingDays: ["MONDAY"],
    });
    expect(v).toMatchObject({
      code: "AY2027-2028-S1",
      academicYear: "2027-2028",
      semester: "1",
      dayStartMin: 420,
      dayEndMin: 1200,
      teachingDays: ["MONDAY"],
    });
  });

  it("picks the latest term by code", () => {
    expect(latestTerm([{ code: "AY2026-2027-S1" }, { code: "AY2026-2027-S2" }, { code: "AY2025-2026-S2" }])?.code).toBe(
      "AY2026-2027-S2",
    );
  });
});

describe("parseSubjectDepartment", () => {
  it("accepts codes and college names", () => {
    expect(parseSubjectDepartment("ARTS_AND_SCIENCES")).toBe("ARTS_AND_SCIENCES");
    expect(parseSubjectDepartment("College of Arts and Sciences")).toBe("ARTS_AND_SCIENCES");
    expect(parseSubjectDepartment("arts & sciences")).toBe("ARTS_AND_SCIENCES");
    expect(parseSubjectDepartment(" College of Education ")).toBe("EDUCATION");
    expect(parseSubjectDepartment("engineering")).toBe("ENGINEERING");
  });

  it("treats blanks as missing and leaves unknown values for validation to report", () => {
    expect(parseSubjectDepartment("")).toBeUndefined();
    expect(parseSubjectDepartment(null)).toBeUndefined();
    expect(parseSubjectDepartment("Nursing")).toBe("Nursing");
  });
});
