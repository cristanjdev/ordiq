import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { workbookTemplateUrl, type WorkbookTemplateScope } from "@/lib/workbook-templates";

// Exercise the download handler and real workbook generation independently of sign-in.
vi.mock("@/server/http/dean-route", () => ({
  withDeanRoute: (handler: (request: NextRequest) => Promise<Response>) => handler,
}));

import { GET } from "./route";

describe("page-specific import template downloads", () => {
  const cases: Array<[WorkbookTemplateScope, string[]]> = [
    ["faculty", ["Faculty"]],
    ["rooms", ["Rooms"]],
    ["subjects", ["Subjects"]],
    ["sections", ["Sections"]],
    ["offerings", ["Offerings"]],
  ];

  it.each(cases)(
    "downloads only the %s template with readable, styled headers",
    async (scope, expectedSheets) => {
      const termCode = "AY2026-2027-S1";
      const response = await GET(
        new NextRequest(`http://localhost${workbookTemplateUrl(scope, termCode)}`),
        undefined,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
      expect(response.headers.get("Content-Disposition")).toContain(
        `filename="ORDIQ - ${expectedSheets[0]} Import Template - ${termCode}.xlsx"`,
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(
        Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer,
      );
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(expectedSheets);
      for (const sheet of workbook.worksheets) {
        expect(sheet.rowCount).toBe(1);
        expect(sheet.getCell("A1").text).toMatch(/^[A-Z]/);
        expect(sheet.getCell("A1").fill).toMatchObject({ fgColor: { argb: "FF7A121B" } });
        expect(sheet.getColumn(2).width).toBeGreaterThanOrEqual(12);
      }
    },
  );

  it("preserves the complete workbook for older links without a scope", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/imports?template=1"),
      undefined,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer,
    );
    expect(workbook.worksheets).toHaveLength(11);
    expect(response.headers.get("Content-Disposition")).toContain("ORDIQ - Complete Import Template - ");
  });

  it.each(["unknown", "constructor", "__proto__", ""])(
    "rejects invalid scope %s instead of downloading the full workbook",
    async (scope) => {
      await expect(
        GET(
          new NextRequest(`http://localhost/api/v1/imports?template=1&scope=${scope}`),
          undefined,
        ),
      ).rejects.toMatchObject({ code: "INVALID_TEMPLATE_SCOPE" });
    },
  );
});
