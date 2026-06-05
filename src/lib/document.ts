import { makeId } from "@/lib/ids";
import type { GridSheet, IntermediateDocument, SourceKind } from "@/types";

function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r/g, "").trim();
}

function clipText(text: string, limit = 12000) {
  const normalized = text.replace(/\u0000/g, "").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n...` : normalized;
}

function kindFromName(fileName: string): SourceKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "excel";
  if (lower.endsWith(".docx")) return "word";
  if (lower.endsWith(".pdf")) return "pdf";
  return "unknown";
}

function sheetToText(sheet: GridSheet) {
  const lines = sheet.rows
    .slice(0, 80)
    .map((row, rowIndex) => `${rowIndex + 1}: ${row.map((cell, index) => `[${index + 1}]${cell}`).join(" | ")}`);
  return `# Sheet: ${sheet.name}\n${lines.join("\n")}`;
}

export async function parseUploadToDocument(file: File): Promise<IntermediateDocument> {
  const fileName = file.name;
  const sourceKind = kindFromName(fileName);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (buffer.length === 0) {
    throw new Error("文件为空，无法解析。");
  }

  if (sourceKind === "excel") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        blankrows: false,
        defval: ""
      });
      return {
        name,
        rows: rows.map((row) => row.map(cleanCell))
      };
    }).filter((sheet) => sheet.rows.length > 0);

    if (!sheets.length) throw new Error("Excel 文件未发现可解析的工作表。");

    const text = sheets.map(sheetToText).join("\n\n");
    return {
      id: makeId("doc"),
      fileName,
      sourceKind,
      sheets,
      text,
      pages: [],
      stats: {
        sheetCount: sheets.length,
        rowCount: sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
        pageCount: 0,
        charCount: text.length
      },
      sample: clipText(text)
    };
  }

  if (sourceKind === "word") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value || "";
    if (!text.trim()) throw new Error("Word 文件未提取到文本内容。");
    return {
      id: makeId("doc"),
      fileName,
      sourceKind,
      sheets: [],
      text,
      pages: [],
      stats: {
        sheetCount: 0,
        rowCount: text.split(/\n+/).filter(Boolean).length,
        pageCount: 0,
        charCount: text.length
      },
      sample: clipText(text)
    };
  }

  if (sourceKind === "pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    const text = result.text || "";
    if (!text.trim()) throw new Error("PDF 文件未提取到文本内容。");
    const pages = text.split(/\f|\n\s*第\s*\d+\s*页\s*\n/g).filter((page) => page.trim());
    return {
      id: makeId("doc"),
      fileName,
      sourceKind,
      sheets: [],
      text,
      pages,
      stats: {
        sheetCount: 0,
        rowCount: text.split(/\n+/).filter(Boolean).length,
        pageCount: result.numpages || pages.length,
        charCount: text.length
      },
      sample: clipText(text)
    };
  }

  throw new Error("暂不支持该文件格式，请上传 .xlsx、.xls、.docx 或 .pdf 文件。");
}
