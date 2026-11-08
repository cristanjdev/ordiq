import { styleExcelWorksheet } from "./excel-style";

export interface ExcelExportOptions {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
}

export async function createExcelExportBuffer(options: ExcelExportOptions) {
  // Load the workbook library only when an export is requested.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ORDIQ Scheduling System";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(options.sheetName);
  sheet.addRow(options.headers);
  sheet.addRows(options.rows);
  styleExcelWorksheet(sheet, { columnCount: options.headers.length });
  return workbook.xlsx.writeBuffer();
}

export async function downloadExcelExport(options: ExcelExportOptions) {
  try {
    const buffer = await createExcelExportBuffer(options);
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(buffer)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = options.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser time to start reading the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    window.alert("The Excel file could not be exported. Please try again.");
  }
}
