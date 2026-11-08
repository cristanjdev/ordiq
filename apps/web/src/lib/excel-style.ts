import type ExcelJS from "exceljs";

// Light-mode tokens from app/globals.css keep exported documents readable in print.
const colors = {
  maroon: "FF7A121B",
  deep: "FF4A0A0F",
  orange: "FFEA580C",
  ink: "FF1E1315",
  muted: "FF685659",
  border: "FFE5DADD",
  surface: "FFF3EEEE",
  white: "FFFFFFFF",
};

function textWidth(text: string): number {
  // Excel widths use character units. Allow extra space for wide Unicode glyphs.
  return Array.from(text).reduce(
    (width, char) => width + ((char.codePointAt(0) ?? 0) > 0x02ff ? 2 : 1),
    0,
  );
}

function wrappedLines(text: string, width: number): number {
  return text.split(/\r\n|\r|\n/).reduce((total, line) => {
    let lines = 1;
    let used = 0;
    for (const word of line.split(/(\s+)/u)) {
      const length = textWidth(word);
      if (used && used + length > width) {
        lines++;
        used = 0;
      }
      lines += Math.max(0, Math.ceil(length / width) - 1);
      used += length > width ? length % width || width : length;
    }
    return total + lines;
  }, 0);
}

/** Shared presentation for every downloadable workbook. Never changes cell values. */
export function styleExcelWorksheet(
  sheet: ExcelJS.Worksheet,
  options: {
    headerRow?: number;
    columnCount: number;
    reportHeading?: boolean;
    /** Per-column alignment; by default the first column is left and the rest centred. */
    align?: ReadonlyArray<"left" | "center" | "right">;
  },
): void {
  const { headerRow = 1, columnCount, reportHeading = false, align } = options;
  sheet.properties.tabColor = { argb: colors.maroon };
  sheet.views = [{ state: "frozen", ySplit: headerRow, showGridLines: false }];
  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: Math.max(headerRow, sheet.rowCount), column: columnCount },
  };

  for (let col = 1; col <= columnCount; col++) {
    let width = 12;
    sheet.getColumn(col).eachCell({ includeEmpty: false }, (cell, row) => {
      if (row < headerRow) return;
      for (const line of cell.text.split(/\r\n|\r|\n/)) {
        width = Math.max(width, textWidth(line) * (row === headerRow ? 1.1 : 1) + 3);
      }
    });
    sheet.getColumn(col).width = Math.min(64, Math.ceil(width));
  }

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber < headerRow) return;
    const isHeader = rowNumber === headerRow;
    let lines = 1;
    for (let col = 1; col <= columnCount; col++) {
      const cell = row.getCell(col);
      cell.font = {
        name: "Calibri",
        size: 11,
        bold: isHeader,
        color: { argb: isHeader ? colors.white : colors.ink },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {
          argb: isHeader
            ? colors.maroon
            : (rowNumber - headerRow) % 2 === 0
              ? colors.surface
              : colors.white,
        },
      };
      cell.alignment = {
        horizontal: align?.[col - 1] ?? (col === 1 ? "left" : "center"),
        vertical: "middle",
        wrapText: true,
      };
      cell.border = {
        bottom: {
          style: isHeader ? "medium" : "hair",
          color: { argb: isHeader ? colors.orange : colors.border },
        },
      };
      lines = Math.max(lines, wrappedLines(cell.text, (sheet.getColumn(col).width ?? 12) - 3));
    }
    row.height = Math.min(409, Math.max(isHeader ? 30 : 24, lines * 15 + 10));
  });

  if (reportHeading) {
    const totalWidth =
      sheet.columns.slice(0, columnCount).reduce((sum, col) => sum + (col.width ?? 12), 0) - 3;
    for (const rowNumber of [1, 2, 3]) {
      if (columnCount > 1) sheet.mergeCells(rowNumber, 1, rowNumber, columnCount);
      const cell = sheet.getCell(rowNumber, 1);
      cell.font = {
        name: "Calibri",
        size: rowNumber === 1 ? 18 : 11,
        bold: rowNumber !== 3,
        color: {
          argb: rowNumber === 1 ? colors.white : rowNumber === 2 ? colors.maroon : colors.muted,
        },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: rowNumber === 1 ? colors.deep : colors.surface },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      const lines = wrappedLines(cell.text, totalWidth / (rowNumber === 1 ? 1.7 : 1));
      sheet.getRow(rowNumber).height = Math.min(
        409,
        Math.max(rowNumber === 1 ? 42 : 30, lines * (rowNumber === 1 ? 24 : 15) + 12),
      );
    }
  }

  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `1:${headerRow}`,
    printArea: `A1:${sheet.getColumn(columnCount).letter}${sheet.rowCount}`,
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  sheet.headerFooter.oddFooter = "&LORDIQ — College of Engineering&RPage &P of &N";
}
