import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const baseUrl = process.env.DEMO_RULE_BASE_URL || process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";
const demosDir = path.join(process.cwd(), "demos");

const demoScenarios = [
  {
    file: "12.25海口龙湖天街-配送发货单PS2512220005001(1).xlsx",
    ruleId: "template_tabular_standard",
    label: "标准配送单表格"
  },
  {
    file: "湖南仓.xlsx",
    ruleId: "template_tabular_summary",
    label: "汇总明细表格"
  },
  {
    file: "多门店分Sheet出库单.xlsx",
    ruleId: "template_multisheet_tabular",
    label: "多 Sheet 门店表格"
  },
  {
    file: "欢乐牧场模板0430.xlsx",
    ruleId: "template_matrix_store_columns",
    label: "门店矩阵转置"
  },
  {
    file: "门店调拨单-卡片式.xlsx",
    ruleId: "template_card_transfer",
    label: "卡片式调拨"
  },
  {
    file: "黔寨寨贵州烙锅（鞍山店）常温.pdf",
    ruleId: "template_pdf_text_numbered",
    label: "PDF 编号文本"
  }
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url}, got: ${text.slice(0, 240)}`);
  }
}

async function postFile(endpoint, filePath, extra = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".pdf"
    ? "application/pdf"
    : ext === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const blob = new Blob([fs.readFileSync(filePath)], { type });
  const form = new FormData();
  form.append("file", blob, path.basename(filePath));
  Object.entries(extra).forEach(([key, value]) => form.append(key, value));
  const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
  return { response, data: await readJson(response) };
}

async function getRules() {
  const response = await fetch(`${baseUrl}/api/rules`, { cache: "no-store" });
  const data = await readJson(response);
  assert(response.ok, "Rules API failed");
  return data.rules || [];
}

function previewWorkbook(filePath) {
  if (!/\.(xlsx|xls)$/i.test(filePath)) return [];
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  return workbook.SheetNames.slice(0, 4).map((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      header: 1,
      raw: false,
      blankrows: false,
      defval: ""
    }).map((row) => row.map((cell) => String(cell ?? "").replace(/\r/g, "").trim()));
    return {
      name,
      rowCount: rows.length,
      head: rows.slice(0, 6),
      tail: rows.slice(Math.max(0, rows.length - 4))
    };
  });
}

function textValue(value) {
  return String(value ?? "").trim();
}

function rowDestination(row) {
  return textValue(row.storeName) || [row.recipientName, row.recipientPhone, row.recipientAddress].map(textValue).filter(Boolean).join("|");
}

function semanticStats(rows) {
  const fieldCount = (field) => rows.filter((row) => textValue(row[field])).length;
  const labelBleedRows = rows.filter((row) =>
    ["storeName", "recipientName", "recipientPhone", "recipientAddress", "skuCode", "skuName", "skuSpec"].some((field) =>
      /(^|\s)(收货机构|收货人|收货电话|收货地址|联系人|联系电话|物品编码|物品名称|规格|数量|合计|制单人|审核人|签字)(\s|[:：|]|$)/.test(textValue(row[field]))
    )
  );
  const pipeRows = rows.filter((row) => Object.values(row).some((value) => typeof value === "string" && value.includes("|")));
  const weakSkuRows = rows.filter((row) => {
    const code = textValue(row.skuCode);
    const name = textValue(row.skuName);
    return /^(合计|序号|物品编码|商品编码|编码|收货|备注|制单|打印|电话|地址)$/.test(code) ||
      /^(合计|序号|物品名称|商品名称|名称|收货|备注|制单|打印|电话|地址)$/.test(name);
  });
  const missingDestinationRows = rows.filter((row) => {
    const hasStore = Boolean(textValue(row.storeName));
    const hasRecipientGroup = Boolean(textValue(row.recipientName) && textValue(row.recipientPhone) && textValue(row.recipientAddress));
    return !hasStore && !hasRecipientGroup;
  });
  const quantitySignature = rows.map((row) => Number(row.skuQuantity)).filter((value) => Number.isFinite(value));
  return {
    rows: rows.length,
    groups: new Set(rows.map(rowDestination)).size,
    externalCode: fieldCount("externalCode"),
    storeName: fieldCount("storeName"),
    recipientName: fieldCount("recipientName"),
    recipientPhone: fieldCount("recipientPhone"),
    recipientAddress: fieldCount("recipientAddress"),
    skuSpec: fieldCount("skuSpec"),
    labelBleed: labelBleedRows.length,
    pipeValues: pipeRows.length,
    weakSkuRows: weakSkuRows.length,
    missingDestinationRows: missingDestinationRows.length,
    quantitySum: quantitySignature.reduce((sum, value) => sum + value, 0),
    quantityHead: quantitySignature.slice(0, 12)
  };
}

function compactRows(rows) {
  const indexes = [0, 1, 2, Math.floor(rows.length / 2), rows.length - 2, rows.length - 1]
    .filter((index) => index >= 0 && index < rows.length);
  return [...new Set(indexes)].map((index) => {
    const row = rows[index];
    return {
      index: index + 1,
      externalCode: row.externalCode,
      storeName: row.storeName,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      recipientAddress: row.recipientAddress,
      skuCode: row.skuCode,
      skuName: row.skuName,
      skuQuantity: row.skuQuantity,
      skuSpec: row.skuSpec,
      remark: row.remark,
      source: row.sourceSheet || row.sourceSection
    };
  });
}

async function main() {
  const rules = await getRules();
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const results = [];

  for (const scenario of demoScenarios) {
    const filePath = path.join(demosDir, scenario.file);
    assert(fs.existsSync(filePath), `Demo missing: ${scenario.file}`);
    const rule = ruleById.get(scenario.ruleId);
    assert(rule, `Rule missing: ${scenario.ruleId}`);

    const parsed = await postFile("/api/parse", filePath, { rule: JSON.stringify(rule) });
    assert(parsed.response.ok, `Parse failed for ${scenario.file}`);
    const rows = parsed.data.result?.rows || [];
    const issues = parsed.data.result?.issues || [];
    results.push({
      scenario: scenario.label,
      file: scenario.file,
      ruleId: scenario.ruleId,
      ruleName: rule.name,
      layout: rule.layout,
      sheetMode: rule.sheetMode,
      config: {
        headerRowIndex: rule.headerRowIndex,
        dataStartRowIndex: rule.dataStartRowIndex,
        stopWhenRowMatches: rule.stopWhenRowMatches,
        matrix: rule.matrix,
        sectionStartPattern: rule.sectionStartPattern,
        itemLinePattern: rule.itemLinePattern,
        mappings: rule.mappings
      },
      document: {
        stats: parsed.data.document?.stats,
        workbookPreview: previewWorkbook(filePath)
      },
      parsed: {
        stats: semanticStats(rows),
        issueCount: issues.length,
        issues: issues.slice(0, 8).map((issue) => ({
          severity: issue.severity,
          rowNumber: issue.rowNumber,
          field: issue.field,
          message: issue.message
        })),
        samples: compactRows(rows)
      }
    });
  }

  console.log(JSON.stringify({ baseUrl, generatedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
