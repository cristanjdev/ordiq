import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/http/dean-route", () => ({
  withDeanRoute:
    (handler: (req: NextRequest, auth: unknown) => Promise<Response>) => (req: NextRequest) =>
      handler(req, { user: { username: "dean" } }),
}));

vi.mock("@/server/modules/reports/reports.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/reports/reports.service")>();
  return {
    ...actual,
    generateScheduleReport: vi.fn(async ({ format }: { format: "PDF" | "XLSX" }) => ({
      fileName: format === "PDF" ? "section-schedule.pdf" : "section-schedule.xlsx",
      mimeType:
        format === "PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(format === "PDF" ? "%PDF-1.4\nreport\n%%EOF" : "excel-workbook"),
      watermark: "CANDIDATE SCHEDULE",
      summaryMetrics: {},
    })),
  };
});

import { GET } from "./route";

describe("report file responses", () => {
  it("returns PDF bytes inline so a new tab can display the report", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/reports?reportType=SECTION_SCHEDULE&format=PDF"),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe(
      'inline; filename="section-schedule.pdf"',
    );
    expect(await response.text()).toBe("%PDF-1.4\nreport\n%%EOF");
  });

  it("continues to return Excel as a downloadable attachment", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/reports?reportType=SECTION_SCHEDULE&format=XLSX"),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="section-schedule.xlsx"',
    );
    expect(await response.text()).toBe("excel-workbook");
  });

  it("preserves explicit JSON metadata requests for other API consumers", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/v1/reports?format=PDF&mode=json"),
      undefined,
    );
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      fileName: "section-schedule.pdf",
      watermark: "CANDIDATE SCHEDULE",
    });
  });
});
