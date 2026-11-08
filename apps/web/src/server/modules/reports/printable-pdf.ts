import { boldWidths, regularWidths } from "./pdf-font-metrics";

export type ColumnAlign = "left" | "center" | "right";

/** One titled table in a report, e.g. one section's timetable. */
export interface PdfSection {
  heading?: string;
  /** Short line under the heading, e.g. "4 classes · 6 units". */
  note?: string;
  headers: string[];
  rows: string[][];
  align?: ColumnAlign[];
  /** Shown instead of rows when the section has none. */
  emptyText?: string;
}

export interface PdfReport {
  title: string;
  subtitle: string;
  watermark: string;
  /** A sentence under the title explaining what the report shows. */
  intro?: string;
  /** Key figures shown as tiles on the first page. */
  summary?: Array<{ label: string; value: string }>;
  sections?: PdfSection[];
  /** Single-table shorthand, kept for simple reports. */
  headers?: string[];
  rows?: string[][];
}

const winAnsi = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
function byteCode(char: string): number {
  const code = char.codePointAt(0) ?? 32;
  if (code >= 32 && code <= 255) return code;
  const index = winAnsi.indexOf(char);
  return index >= 0 ? index + 128 : 63;
}

function width(text: string, size: number, bold = false): number {
  const metrics = bold ? boldWidths : regularWidths;
  return (
    (Array.from(text).reduce((sum, char) => sum + (metrics[byteCode(char) - 32] ?? 556), 0) *
      size) /
    1000
  );
}

function pdfText(text: string): string {
  return Array.from(text)
    .map((char) => {
      const code = byteCode(char);
      if (code > 126) return `\\${code.toString(8).padStart(3, "0")}`;
      return /[()\\]/.test(char) ? `\\${char}` : String.fromCharCode(code);
    })
    .join("");
}

function wrap(text: string, available: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\t/g, " ").split(/\r\n|\r|\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && width(`${line} ${word}`, size, bold) > available) {
        lines.push(line);
        line = "";
      }
      if (line) line += " ";
      for (const char of word) {
        if (line && width(line + char, size, bold) > available) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

const maroon = "0.478 0.071 0.106";
const orange = "0.918 0.345 0.047";
const ink = "0.118 0.075 0.082";
const muted = "0.408 0.337 0.349";
const border = "0.898 0.855 0.867";
const surface = "0.973 0.961 0.961";
const shade = "0.953 0.933 0.933";

/**
 * A measured, paginated report using the standard PDF fonts (no platform font
 * dependency): a title block, optional key-figure tiles, then one or more
 * titled tables whose headings and column headers repeat on every page.
 */
export function buildPrintablePdfBuffer(input: PdfReport): Buffer {
  const sections: PdfSection[] =
    input.sections ?? [{ headers: input.headers ?? [], rows: input.rows ?? [] }];
  const subtitle = input.subtitle.split(/\r\n|\r|\n/).map((part) => part.trim()).filter(Boolean).join(" · ");
  const landscape = sections.some((s) => s.headers.length >= 6)
    || (input.summary?.length ?? 0) > 4
    || width(subtitle, 8) > 531;
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;
  const margin = 32;
  const usableWidth = pageWidth - margin * 2;
  const bottom = pageHeight - 44;
  const fontSize = 9;
  const lineHeight = 12;
  const padding = 6;

  const pages: string[][] = [];
  let ops: string[] = [];
  let y = margin;

  const rectangle = (x: number, top: number, w: number, h: number, color: string) => {
    ops.push(
      `${color} rg ${x.toFixed(2)} ${(pageHeight - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
    );
  };
  const text = (value: string, x: number, top: number, size: number, bold: boolean, color: string) => {
    if (!value) return;
    ops.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${(pageHeight - top - size).toFixed(2)} Tm (${pdfText(value)}) Tj ET`,
    );
  };
  const paragraph = (value: string, size: number, bold: boolean, color: string, gap = 4) => {
    for (const line of wrap(value, usableWidth, size, bold)) {
      text(line, margin, y, size, bold, color);
      y += size + gap;
    }
  };
  const watermarkBand = () => {
    if (!input.watermark) return;
    const lines = wrap(input.watermark, usableWidth - 20, 8, true);
    rectangle(margin, y, usableWidth, lines.length * 11 + 10, "0.996 0.953 0.886");
    rectangle(margin, y, 3, lines.length * 11 + 10, orange);
    y += 6;
    for (const line of lines) {
      text(line, margin + 12, y, 8, true, "0.604 0.204 0.071");
      y += 11;
    }
    y += 4;
  };

  const startPage = (first: boolean) => {
    ops = [];
    pages.push(ops);
    y = margin;
    if (first) {
      paragraph("ORDIQ · MSEUF College of Engineering", 9, true, maroon);
      y += 2;
      paragraph(input.title, 18, true, ink, 5);
      const subtitleSize = Math.min(8, usableWidth * 8 / Math.max(1, width(subtitle, 8)));
      text(subtitle, margin, y, subtitleSize, false, muted);
      y += subtitleSize + 4;
      y += 6;
      watermarkBand();
      if (input.intro) {
        y += 2;
        paragraph(input.intro, 9, false, ink, 3);
        y += 4;
      }
      if (input.summary?.length) summaryTiles(input.summary);
      y += 6;
    } else {
      const left = `${input.title} (continued)`;
      text(left, margin, y, 9, true, ink);
      text("ORDIQ · College of Engineering", pageWidth - margin - width("ORDIQ · College of Engineering", 8), y + 1, 8, false, muted);
      y += 16;
      watermarkBand();
      y += 4;
    }
  };

  const summaryTiles = (items: Array<{ label: string; value: string }>) => {
    const perRow = items.length;
    const gap = 8;
    const tileWidth = (usableWidth - gap * (perRow - 1)) / perRow;
    for (let i = 0; i < items.length; i += perRow) {
      const row = items.slice(i, i + perRow);
      const labelLines = row.map((item) => wrap(item.label, tileWidth - 16, 7.5));
      const height = 30 + Math.max(...labelLines.map((l) => l.length)) * 9;
      row.forEach((item, index) => {
        const x = margin + index * (tileWidth + gap);
        rectangle(x, y, tileWidth, height, surface);
        rectangle(x, y, tileWidth, 2, maroon);
        let size = 13;
        while (size > 8 && width(item.value, size, true) > tileWidth - 16) size -= 0.5;
        text(item.value, x + 8, y + 9 + (13 - size) / 2, size, true, ink);
        (labelLines[index] ?? []).forEach((line, li) => text(line, x + 8, y + 26 + li * 9, 7.5, false, muted));
      });
      y += height + gap;
    }
  };

  const columnWidths = (section: PdfSection): number[] => {
    const cap = usableWidth * 0.45;
    const desired = section.headers.map((header, col) =>
      section.rows.reduce(
        (largest, row) => Math.min(cap, Math.max(largest, width(row[col] ?? "", fontSize) + padding * 2)),
        Math.min(cap, Math.max(40, width(header, fontSize, true) + padding * 2)),
      ),
    );
    const total = desired.reduce((sum, v) => sum + v, 0);
    if (total <= usableWidth) {
      // Everything fits: share the spare space in proportion to the content.
      return desired.map((v) => (v * usableWidth) / total);
    }
    // Too wide: every column keeps room for its longest header word, and the
    // rest of the width goes to the columns with the most text.
    const floor = section.headers.map((h, col) =>
      Math.min(
        desired[col] ?? 40,
        Math.max(36, ...h.split(/\s+/).map((w) => width(w, fontSize, true) + padding * 2 + 1)),
      ),
    );
    const floorTotal = floor.reduce((sum, v) => sum + v, 0);
    const spare = Math.max(0, usableWidth - floorTotal);
    const weight = desired.reduce((sum, v, col) => sum + (v - (floor[col] ?? 0)), 0) || 1;
    const widths = desired.map((v, col) => (floor[col] ?? 0) + (spare * (v - (floor[col] ?? 0))) / weight);
    const scale = usableWidth / Math.max(1, widths.reduce((sum, v) => sum + v, 0));
    return widths.map((v) => v * scale);
  };

  const drawSection = (section: PdfSection, index: number) => {
    const columns = columnWidths(section);
    const align = (col: number): ColumnAlign => section.align?.[col] ?? (col === 0 ? "left" : "center");
    const headerLines = section.headers.map((h, col) => wrap(h, (columns[col] ?? 40) - padding * 2, fontSize, true));
    const headerHeight = Math.max(1, ...headerLines.map((l) => l.length)) * lineHeight + padding * 2;
    const headingHeight = (section.heading ? 20 : 0) + (section.note ? 12 : 0);

    const drawRow = (cells: string[][], height: number, header: boolean, shaded: boolean) => {
      rectangle(margin, y, usableWidth, height, header ? maroon : shaded ? shade : "1 1 1");
      let x = margin;
      cells.forEach((lines, col) => {
        const colWidth = columns[col] ?? 40;
        lines.forEach((line, li) => {
          const w = width(line, fontSize, header);
          const offset =
            align(col) === "right"
              ? colWidth - padding - w
              : align(col) === "center"
                ? (colWidth - w) / 2
                : padding;
          text(line, x + Math.max(padding / 2, offset), y + padding + li * lineHeight, fontSize, header, header ? "1 1 1" : ink);
        });
        x += colWidth;
      });
      rectangle(margin, y + height - (header ? 1.5 : 0.5), usableWidth, header ? 1.5 : 0.5, header ? orange : border);
      y += height;
    };
    const drawHeading = (continued: boolean) => {
      if (section.heading) {
        const heading = continued ? `${section.heading.replace(/\s*\(\d+\)$/, "")} (continued)` : section.heading;
        text(heading, margin, y + 4, 11, true, maroon);
        y += 20;
      }
      if (section.note && !continued) {
        text(section.note, margin, y - 2, 8, false, muted);
        y += 12;
      }
      if (section.headers.length && section.rows.length) drawRow(headerLines, headerHeight, true, false);
    };

    const rowCells = (row: string[]) =>
      section.headers.map((_, col) => wrap(row[col] ?? "", (columns[col] ?? 40) - padding * 2, fontSize));

    // Keep a heading with its column headers and first row.
    const first = section.rows[0];
    const firstHeight = first
      ? Math.min(6, Math.max(1, ...rowCells(first).map((l) => l.length))) * lineHeight + padding * 2
      : 26;
    if (index > 0) y += 10;
    if (y + headingHeight + (first ? headerHeight : 0) + firstHeight > bottom) startPage(false);
    drawHeading(false);

    if (!section.rows.length) {
      text(section.emptyText ?? "No records for this report.", margin, y + 2, 9, false, muted);
      y += 20;
      return;
    }

    section.rows.forEach((row, rowIndex) => {
      const cells = rowCells(row);
      const count = Math.max(1, ...cells.map((l) => l.length));
      const height = count * lineHeight + padding * 2;
      const fresh = bottom - (margin + 40 + headingHeight + headerHeight);
      if (height <= fresh && y + height > bottom) {
        startPage(false);
        drawHeading(true);
      }
      let offset = 0;
      while (offset < count) {
        const capacity = Math.floor((bottom - y - padding * 2) / lineHeight);
        if (capacity < 1) {
          startPage(false);
          drawHeading(true);
          continue;
        }
        const take = Math.min(count - offset, capacity);
        drawRow(cells.map((l) => l.slice(offset, offset + take)), take * lineHeight + padding * 2, false, rowIndex % 2 === 1);
        offset += take;
        if (offset < count) {
          startPage(false);
          drawHeading(true);
        }
      }
    });
  };

  startPage(true);
  sections.forEach(drawSection);

  pages.forEach((page, index) => {
    ops = page;
    rectangle(margin, pageHeight - 34, usableWidth, 0.5, border);
    text(subtitle.split(" · ")[0] ?? "", margin, pageHeight - 26, 8, false, muted);
    const pageLabel = `Page ${index + 1} of ${pages.length}`;
    text(pageLabel, pageWidth - margin - width(pageLabel, 8), pageHeight - 26, 8, false, muted);
  });

  const pageIds = pages.map((_, index) => 5 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((page, index) => {
    const stream = page.join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${(pageIds[index] ?? 5) + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  });
  let output = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}
