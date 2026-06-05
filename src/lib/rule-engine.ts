import { FIELD_HINTS } from "@/lib/fields";
import { makeId } from "@/lib/ids";
import { groupRows, validateRows } from "@/lib/validation";
import type { FieldMapping, GridSheet, IntermediateDocument, OrderField, ParsedOrderRow, ParseResult, ParsingRule } from "@/types";

type RowDraft = Partial<Record<OrderField, string | number>> & {
  sourceSheet?: string;
  sourceSection?: string;
  warnings?: string[];
};

function normalize(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toNumber(value: unknown) {
  const match = String(value ?? "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function rowMatches(row: string[], pattern?: string) {
  if (!pattern) return false;
  return new RegExp(pattern, "i").test(row.join(" "));
}

function findColumnByHeader(sheet: GridSheet, headerRowIndex: number, mapping: FieldMapping) {
  if (mapping.kind !== "column") return undefined;
  if (mapping.columnIndex !== undefined) return mapping.columnIndex;
  const header = mapping.header;
  const row = sheet.rows[headerRowIndex] || [];
  const normalizedRow = row.map((cell) => normalize(cell));
  if (header) {
    const exactIndex = normalizedRow.findIndex((cell) => cell === header);
    if (exactIndex >= 0) return exactIndex;
    const partialIndex = normalizedRow.findIndex((cell) => cell.includes(header));
    if (partialIndex >= 0) return partialIndex;
  }
  const hints = FIELD_HINTS[mapping.field];
  const exactHintIndex = normalizedRow.findIndex((cell) => hints.some((hint) => cell === hint));
  if (exactHintIndex >= 0) return exactHintIndex;
  return normalizedRow.findIndex((cell) => hints.some((hint) => cell.includes(hint)));
}

function getRegexValue(mapping: Extract<FieldMapping, { kind: "regex" }>, documentText: string, sectionText?: string) {
  const scopeText = mapping.scope === "section" && sectionText
    ? sectionText
    : mapping.scope === "tail"
      ? documentText.split(/\n/).slice(-20).join("\n")
      : documentText;
  const match = scopeText.match(new RegExp(mapping.pattern, "i"));
  return normalize(match?.[mapping.group ?? 1] ?? mapping.fallback ?? "");
}

function applyCommonMappings(
  draft: RowDraft,
  mappings: FieldMapping[],
  context: {
    row?: string[];
    sheet?: GridSheet;
    headerRowIndex?: number;
    documentText: string;
    sectionText?: string;
    matrixColumnName?: string;
    compoundName?: string;
    compoundQuantity?: number;
  }
) {
  mappings.forEach((mapping) => {
    if (mapping.kind === "column" && context.row && context.sheet && context.headerRowIndex !== undefined) {
      const index = findColumnByHeader(context.sheet, context.headerRowIndex, mapping);
      if (index !== undefined && index >= 0) draft[mapping.field] = normalize(context.row[index] ?? mapping.fallback ?? draft[mapping.field]);
    }
    if (mapping.kind === "cell" && context.sheet) {
      draft[mapping.field] = normalize(context.sheet.rows[mapping.rowIndex]?.[mapping.columnIndex] ?? mapping.fallback ?? draft[mapping.field]);
    }
    if (mapping.kind === "regex") {
      const value = getRegexValue(mapping, context.documentText, context.sectionText);
      if (value && !draft[mapping.field]) draft[mapping.field] = value;
    }
    if (mapping.kind === "constant") {
      draft[mapping.field] = mapping.value;
    }
    if (mapping.kind === "sheetName" && context.sheet) {
      draft[mapping.field] = context.sheet.name;
    }
    if (mapping.kind === "matrixColumn" && context.matrixColumnName) {
      draft[mapping.field] = context.matrixColumnName;
    }
    if (mapping.kind === "compoundPart" && mapping.part === "name" && context.compoundName) {
      if (!draft[mapping.field]) draft[mapping.field] = context.compoundName;
    }
    if (mapping.kind === "compoundPart" && mapping.part === "quantity" && context.compoundQuantity !== undefined) {
      draft[mapping.field] = context.compoundQuantity;
    }
  });
}

function toParsedRow(draft: RowDraft, rowNumber: number): ParsedOrderRow | null {
  const skuCode = normalize(draft.skuCode);
  const skuName = normalize(draft.skuName);
  const skuQuantity = toNumber(draft.skuQuantity);
  const hasUsefulContent = skuCode || skuName || skuQuantity > 0;
  if (!hasUsefulContent) return null;

  return {
    id: makeId("row"),
    rowNumber,
    externalCode: normalize(draft.externalCode) || undefined,
    storeName: normalize(draft.storeName) || undefined,
    recipientName: normalize(draft.recipientName) || undefined,
    recipientPhone: normalize(draft.recipientPhone) || undefined,
    recipientAddress: normalize(draft.recipientAddress) || undefined,
    skuCode,
    skuName,
    skuQuantity,
    skuSpec: normalize(draft.skuSpec) || undefined,
    remark: normalize(draft.remark) || undefined,
    sourceSheet: draft.sourceSheet,
    sourceSection: draft.sourceSection,
    warnings: draft.warnings
  };
}

function parseTabular(document: IntermediateDocument, rule: ParsingRule) {
  const rows: ParsedOrderRow[] = [];
  const sheets = rule.sheetMode === "all" ? document.sheets : document.sheets.slice(0, 1);
  let outputRow = 1;

  sheets.forEach((sheet) => {
    const headerRowIndex = rule.headerRowIndex ?? 0;
    const start = rule.dataStartRowIndex ?? headerRowIndex + 1;
    const end = rule.dataEndRowIndex ?? sheet.rows.length;

    for (let index = start; index < Math.min(end, sheet.rows.length); index += 1) {
      const sourceRow = sheet.rows[index];
      if (!sourceRow?.some(Boolean)) continue;
      if (rowMatches(sourceRow, rule.stopWhenRowMatches)) break;
      if ((rule.skipRowPatterns || []).some((pattern) => rowMatches(sourceRow, pattern))) continue;

      const draft: RowDraft = { sourceSheet: sheet.name };
      applyCommonMappings(draft, rule.mappings, {
        row: sourceRow,
        sheet,
        headerRowIndex,
        documentText: document.text
      });
      const parsed = toParsedRow(draft, outputRow);
      if (parsed) {
        rows.push(parsed);
        outputRow += 1;
      }
    }
  });

  return rows;
}

function splitCompoundCell(value: string) {
  const chunks = value.split(/\n|；|;|、/).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks.map((chunk) => {
    if (/^\d+(?:\.\d+)?$/.test(chunk)) {
      return {
        name: "",
        quantity: Number(chunk)
      };
    }
    const match = chunk.match(/^(.+?)(?:x|X|×|\*)\s*(\d+(?:\.\d+)?)$/);
    return {
      name: normalize(match?.[1] ?? chunk),
      quantity: match ? Number(match[2]) : toNumber(chunk)
    };
  });
}

function stripDocumentLinePrefix(line: string) {
  return line
    .replace(/^\s*\d+:\s*/, "")
    .replace(/\s*\[\d+\]\s*/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .trim();
}

function splitTextSections(documentText: string, rule: ParsingRule) {
  if (rule.sectionStartPattern) {
    const startRegex = new RegExp(rule.sectionStartPattern, "i");
    const sections: string[] = [];
    let current: string[] = [];
    let started = false;

    documentText.split(/\n/).forEach((line) => {
      const content = stripDocumentLinePrefix(line);
      if (startRegex.test(content)) {
        if (current.length) sections.push(current.join("\n"));
        current = [line];
        started = true;
        return;
      }
      if (started) current.push(line);
    });

    if (current.length) sections.push(current.join("\n"));
    const usefulSections = sections.map((section) => section.trim()).filter((section) => section.length > 20);
    if (usefulSections.length) return usefulSections;
  }

  const separator = rule.sectionSeparatorPattern ? new RegExp(rule.sectionSeparatorPattern, "i") : /\n\s*\n/;
  return documentText.split(separator).map((section) => section.trim()).filter((section) => section.length > 20);
}

function parseMatrix(document: IntermediateDocument, rule: ParsingRule) {
  const rows: ParsedOrderRow[] = [];
  if (!rule.matrix) return rows;
  const sheets = rule.sheetMode === "all" ? document.sheets : document.sheets.slice(0, 1);
  let outputRow = 1;

  sheets.forEach((sheet) => {
    const headerRow = sheet.rows[rule.matrix!.headerRowIndex] || [];
    const startColumn = rule.matrix!.matrixStartColumnIndex;
    const endColumn = rule.matrix!.matrixEndColumnIndex ?? headerRow.length;

    for (let rowIndex = rule.matrix!.dataStartRowIndex; rowIndex < sheet.rows.length; rowIndex += 1) {
      const sourceRow = sheet.rows[rowIndex];
      if (!sourceRow?.some(Boolean)) continue;
      if ((rule.skipRowPatterns || []).some((pattern) => rowMatches(sourceRow, pattern))) continue;

      for (let columnIndex = startColumn; columnIndex < endColumn; columnIndex += 1) {
        const quantityCell = String(sourceRow[columnIndex] ?? "").replace(/\r/g, "").trim();
        if (!quantityCell) continue;
        const headerName = normalize(headerRow[columnIndex]);
        if (!headerName) continue;

        const compounds = splitCompoundCell(quantityCell);
        const entries = compounds.length ? compounds : [{ name: "", quantity: toNumber(quantityCell) }];
        entries.forEach((entry) => {
          if (!entry.quantity) return;
          const draft: RowDraft = { sourceSheet: sheet.name };
          applyCommonMappings(draft, rule.mappings, {
            row: sourceRow,
            sheet,
            headerRowIndex: rule.matrix!.headerRowIndex,
            documentText: document.text,
            matrixColumnName: headerName,
            compoundName: entry.name,
            compoundQuantity: entry.quantity
          });
          if (!draft.skuQuantity) draft.skuQuantity = entry.quantity;
          const parsed = toParsedRow(draft, outputRow);
          if (parsed) {
            rows.push(parsed);
            outputRow += 1;
          }
        });
      }
    }
  });

  return rows;
}

function parseTextBlocks(document: IntermediateDocument, rule: ParsingRule) {
  const rows: ParsedOrderRow[] = [];
  const sections = splitTextSections(document.text, rule);
  const itemRegex = new RegExp(rule.itemLinePattern || "([A-Za-z0-9_-]{2,})\\s+[|｜]?\\s*(\\S.*?)\\s+[|｜]?\\s*(\\d+(?:\\.\\d+)?)", "i");
  let outputRow = 1;

  sections.forEach((section, sectionIndex) => {
    const cleanedSection = section.split(/\n/).map(stripDocumentLinePrefix).join("\n");
    const baseDraft: RowDraft = { sourceSection: `区块 ${sectionIndex + 1}` };
    applyCommonMappings(baseDraft, rule.mappings, {
      documentText: document.text,
      sectionText: cleanedSection
    });

    let foundItem = false;
    const itemLines = cleanedSection.split(/\n/).map((line) => line.trim()).filter(Boolean);
    itemLines.forEach((line) => {
      const match = line.match(itemRegex);
      if (!match) return;
      foundItem = true;
      const draft: RowDraft = {
        ...baseDraft,
        skuCode: normalize(match[1]),
        skuName: normalize(match[2]),
        skuSpec: normalize(match[3]),
        skuQuantity: toNumber(match[4] ?? match[3])
      };
      const parsed = toParsedRow(draft, outputRow);
      if (parsed) {
        rows.push(parsed);
        outputRow += 1;
      }
    });

    if (!foundItem && /编码|名称|数量/.test(cleanedSection)) {
      const lines = cleanedSection.split(/\n/).map((line) => line.trim()).filter(Boolean);
      lines.forEach((line) => {
        const fallback = line.match(/([A-Za-z0-9_-]{2,}).*?([\u4e00-\u9fa5A-Za-z][^0-9|｜]*).*?(\d+(?:\.\d+)?)/);
        if (!fallback) return;
        const draft: RowDraft = {
          ...baseDraft,
          skuCode: normalize(fallback[1]),
          skuName: normalize(fallback[2]),
          skuQuantity: Number(fallback[3])
        };
        const parsed = toParsedRow(draft, outputRow);
        if (parsed) {
          rows.push(parsed);
          outputRow += 1;
        }
      });
    }
  });

  return rows;
}

function parseNumberedTextRows(document: IntermediateDocument, rule: ParsingRule) {
  const rows: ParsedOrderRow[] = [];
  const baseDraft: RowDraft = {};
  applyCommonMappings(baseDraft, rule.mappings, {
    documentText: document.text,
    sectionText: document.text
  });

  const lines = document.text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const merged: string[] = [];
  lines.forEach((line) => {
    if (/^\d{1,4}\D/.test(line)) {
      merged.push(line);
    } else if (merged.length && !/物品类别|第\d+页|合\s*计|制单日期|收货人签字|打印次数/.test(line)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${line}`;
    }
  });

  merged.forEach((line, index) => {
    const match = line.match(/^\d{1,4}(.+?)([A-Za-z]{2,}[A-Za-z0-9_-]{2,})(.+?)(?:件|瓶|包|桶|箱|个|套|条|码|均码|L码|XL码|2XL码|3XL码|4XL码)(\d+(?:\.\d+)?)$/);
    if (!match) return;
    const nameAndSpec = normalize(match[3]);
    const specMatch = nameAndSpec.match(/(.+?)(\d+(?:\.\d+)?\s*(?:kg|KG|g|G|ml|ML|L|l|码|\*)[\s\S]*)$/);
    const draft: RowDraft = {
      ...baseDraft,
      skuCode: normalize(match[2]),
      skuName: normalize(specMatch?.[1] || nameAndSpec),
      skuSpec: normalize(specMatch?.[2] || ""),
      skuQuantity: Number(match[4]),
      sourceSection: "编号文本行"
    };
    const parsed = toParsedRow(draft, rows.length + index + 1);
    if (parsed) rows.push(parsed);
  });

  return rows;
}

export function executeRule(document: IntermediateDocument, rule: ParsingRule, existingExternalCodes: string[] = []): ParseResult {
  const started = performance.now();
  let rows: ParsedOrderRow[] = [];

  if (rule.layout === "matrix") rows = parseMatrix(document, rule);
  else if (rule.layout === "cards") {
    rows = parseTextBlocks(document, rule);
  }
  else if (rule.layout === "textBlocks" || rule.layout === "multiSection") {
    const numberedRows = parseNumberedTextRows(document, rule);
    rows = numberedRows.length >= 3 ? numberedRows : parseTextBlocks(document, rule);
  }
  else rows = parseTabular(document, rule);

  const issues = validateRows(rows, existingExternalCodes);
  const groups = groupRows(rows);
  return {
    rows,
    groups,
    issues,
    elapsedMs: Math.round(performance.now() - started)
  };
}
