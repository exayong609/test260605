import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

async function postBuffer(endpoint, fileName, buffer, type, extra = {}) {
  const blob = new Blob([buffer], { type });
  const form = new FormData();
  form.append("file", blob, fileName);
  Object.entries(extra).forEach(([key, value]) => form.append(key, value));
  const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST", body: form });
  return { response, data: await readJson(response) };
}

async function checkServer() {
  const response = await fetch(baseUrl);
  assert(response.ok, `App is not reachable at ${baseUrl}`);
  return response.status;
}

async function checkHealth() {
  const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
  const data = await readJson(response);
  assert(response.ok && data.ok, "Health API failed");
  assert(data.defaultRuleCount >= 6, "Health API reports missing default rules");
  return data;
}

async function checkDefaultRules() {
  const response = await fetch(`${baseUrl}/api/rules`, { cache: "no-store" });
  const data = await readJson(response);
  assert(response.ok, "Rules API failed");
  assert(Array.isArray(data.rules) && data.rules.length >= 6, "Default rule templates are missing");
  return data.rules;
}

async function checkDemoParsing() {
  const demosDir = path.join(process.cwd(), "demos");
  const files = fs.existsSync(demosDir)
    ? fs.readdirSync(demosDir).filter((file) => /\.(xlsx|xls|pdf|docx)$/i.test(file))
    : [];
  assert(files.length > 0, "No demo files found");

  const results = [];
  for (const file of files) {
    const filePath = path.join(demosDir, file);
    const generated = await postFile("/api/rules/generate", filePath);
    assert(generated.response.ok, `Rule generation failed for ${file}`);
    assert(generated.data.rule?.mappings?.length > 0, `Generated rule has no mappings for ${file}`);

    const parsed = await postFile("/api/parse", filePath, {
      rule: JSON.stringify(generated.data.rule)
    });
    assert(parsed.response.ok, `Parse failed for ${file}`);
    assert((parsed.data.result?.rows?.length || 0) > 0, `No rows parsed for ${file}`);
    results.push({
      file,
      layout: generated.data.rule.layout,
      provider: generated.data.provider,
      rows: parsed.data.result.rows.length,
      issues: parsed.data.result.issues.length,
      elapsedMs: parsed.data.result.elapsedMs
    });
  }
  return results;
}

function createPerfWorkbook(rowCount) {
  const header = [
    "externalCode",
    "storeName",
    "recipientName",
    "recipientPhone",
    "recipientAddress",
    "skuCode",
    "skuName",
    "skuQuantity",
    "skuSpec",
    "remark"
  ];
  const rows = [header];
  for (let index = 1; index <= rowCount; index += 1) {
    rows.push([
      `PERF-${String(index).padStart(5, "0")}`,
      `Store ${index % 50}`,
      `Receiver ${index}`,
      `138${String(10000000 + index).slice(-8)}`,
      `Address ${index}`,
      `SKU-${String(index).padStart(5, "0")}`,
      `Item ${index}`,
      (index % 9) + 1,
      "1*1",
      ""
    ]);
  }
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "ImportData");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function workbookBuffer(sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ name, rows }) => {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  });
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function parseSyntheticWorkbook(fileName, rowsOrSheets, rule) {
  const sheets = Array.isArray(rowsOrSheets[0]?.rows) ? rowsOrSheets : [{ name: "ImportData", rows: rowsOrSheets }];
  const buffer = workbookBuffer(sheets);
  const parsed = await postBuffer(
    "/api/parse",
    fileName,
    buffer,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { rule: JSON.stringify(rule) }
  );
  assert(parsed.response.ok, `Synthetic parse failed for ${fileName}`);
  return parsed.data.result;
}

async function checkSyntheticComplexFormats(defaultRules) {
  const ruleById = new Map(defaultRules.map((rule) => [rule.id, rule]));
  const multiSheetRule = ruleById.get("template_multisheet_tabular");
  const weeklyRule = ruleById.get("template_weekly_plan_matrix");
  const cardRule = ruleById.get("template_card_transfer");
  assert(multiSheetRule && weeklyRule && cardRule, "Synthetic rules are missing");

  const multiSheetResult = await parseSyntheticWorkbook(
    "synthetic-multisheet.xlsx",
    [
      {
        name: "门店A",
        rows: [
          ["外部编码", "收件人", "电话", "地址", "编码", "名称", "数量", "规格", "备注"],
          ["MS-001", "张三", "13812345678", "A地址", "SKU-MS-1", "牛肉", 2, "1kg", ""]
        ]
      },
      {
        name: "门店B",
        rows: [
          ["外部编码", "收件人", "电话", "地址", "编码", "名称", "数量", "规格", "备注"],
          ["MS-002", "李四", "13912345678", "B地址", "SKU-MS-2", "土豆", 3, "500g", ""]
        ]
      }
    ],
    multiSheetRule
  );
  assert(multiSheetResult.rows.length === 2, `Expected 2 multisheet rows, got ${multiSheetResult.rows.length}`);
  assert(new Set(multiSheetResult.rows.map((row) => row.storeName)).size === 2, "Sheet names were not mapped to stores");

  const weeklyResult = await parseSyntheticWorkbook(
    "synthetic-weekly-plan.xlsx",
    [
      ["门店", "周一", "周二"],
      ["门店A", "米饭x2\n面条x3", "牛肉x1"],
      ["门店B", "", "蔬菜x4"]
    ],
    weeklyRule
  );
  assert(weeklyResult.rows.length === 4, `Expected 4 weekly matrix rows, got ${weeklyResult.rows.length}`);
  assert(weeklyResult.rows.every((row) => row.skuCode === "AUTO-SKU"), "Weekly rule did not use default SKU code");

  const cardResult = await parseSyntheticWorkbook(
    "synthetic-card.xlsx",
    [
      ["内容"],
      ["▶ 调拨记录 #1"],
      ["调拨单号：CARD-001"],
      ["目标门店：门店A"],
      ["收货人：王五 收货电话：13712345678"],
      ["地址：A卡片地址"],
      ["SKU-CARD-1 | 土豆片 | 500g | 2"],
      ["SKU-CARD-2 | 牛肉卷 | 1kg | 3"],
      ["▶ 调拨记录 #2"],
      ["调拨单号：CARD-002"],
      ["目标门店：门店B"],
      ["收货人：赵六 收货电话：13612345678"],
      ["地址：B卡片地址"],
      ["SKU-CARD-3 | 米粉 | 250g | 4"]
    ],
    cardRule
  );
  assert(cardResult.rows.length === 3, `Expected 3 card rows, got ${cardResult.rows.length}`);
  assert(new Set(cardResult.rows.map((row) => row.externalCode)).size === 2, "Card sections were not separated");

  return {
    multiSheet: {
      rows: multiSheetResult.rows.length,
      stores: Array.from(new Set(multiSheetResult.rows.map((row) => row.storeName)))
    },
    weeklyPlan: {
      rows: weeklyResult.rows.length,
      sample: weeklyResult.rows.slice(0, 2).map((row) => `${row.storeName}:${row.remark}:${row.skuName}x${row.skuQuantity}`)
    },
    cards: {
      rows: cardResult.rows.length,
      orders: Array.from(new Set(cardResult.rows.map((row) => row.externalCode)))
    }
  };
}

async function checkPerformance() {
  const buffer = createPerfWorkbook(1000);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const form = new FormData();
  form.append("file", blob, "perf-1000.xlsx");
  const generateStart = performance.now();
  const generatedResponse = await fetch(`${baseUrl}/api/rules/generate`, { method: "POST", body: form });
  const generated = await readJson(generatedResponse);
  const generateRoundTripMs = Math.round(performance.now() - generateStart);
  assert(generatedResponse.ok, "Performance rule generation failed");

  const parseForm = new FormData();
  parseForm.append("file", blob, "perf-1000.xlsx");
  parseForm.append("rule", JSON.stringify(generated.rule));
  const parseStart = performance.now();
  const parseResponse = await fetch(`${baseUrl}/api/parse`, { method: "POST", body: parseForm });
  const parsed = await readJson(parseResponse);
  const parseRoundTripMs = Math.round(performance.now() - parseStart);
  assert(parseResponse.ok, "Performance parse failed");
  assert(parsed.result?.rows?.length === 1000, `Expected 1000 rows, got ${parsed.result?.rows?.length || 0}`);
  assert(parseRoundTripMs < 10000, `1000-row parse exceeded 10 seconds: ${parseRoundTripMs}ms`);

  return {
    rows: parsed.result.rows.length,
    issues: parsed.result.issues.length,
    engineMs: parsed.result.elapsedMs,
    generateRoundTripMs,
    parseRoundTripMs
  };
}

async function checkSubmitAndHistory() {
  const externalCode = `SMOKE-${Date.now()}`;
  const rows = [
    {
      id: `${externalCode}-1`,
      rowNumber: 1,
      externalCode,
      storeName: "Smoke Store",
      recipientName: "Smoke User",
      recipientPhone: "13812345678",
      recipientAddress: "Smoke Address",
      skuCode: "SKU-SMOKE-1",
      skuName: "Smoke Item 1",
      skuQuantity: 2,
      skuSpec: "1*1"
    },
    {
      id: `${externalCode}-2`,
      rowNumber: 2,
      externalCode,
      storeName: "Smoke Store",
      recipientName: "Smoke User",
      recipientPhone: "13812345678",
      recipientAddress: "Smoke Address",
      skuCode: "SKU-SMOKE-2",
      skuName: "Smoke Item 2",
      skuQuantity: 3,
      skuSpec: "1*1"
    }
  ];

  const submitResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows })
  });
  const submitted = await readJson(submitResponse);
  assert(submitResponse.ok, "Submit API failed");
  assert(submitted.successCount === 1, `Expected one grouped order, got ${submitted.successCount}`);

  const historyResponse = await fetch(`${baseUrl}/api/orders?query=${externalCode}&page=1&pageSize=5`);
  const history = await readJson(historyResponse);
  assert(historyResponse.ok, "History API failed");
  assert(history.total >= 1, "Submitted order not found in history");

  return {
    externalCode,
    successCount: submitted.successCount,
    failureCount: submitted.failureCount,
    historyTotal: history.total
  };
}

async function checkExport() {
  const rows = [
    {
      id: "export-smoke-row",
      rowNumber: 1,
      externalCode: "EXPORT-SMOKE",
      storeName: "Export Store",
      recipientName: "Export User",
      recipientPhone: "13812345678",
      recipientAddress: "Export Address",
      skuCode: "SKU-EXPORT",
      skuName: "Export Item",
      skuQuantity: 1,
      skuSpec: "1*1"
    }
  ];
  const response = await fetch(`${baseUrl}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows })
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "";
  assert(response.ok, "Export API failed");
  assert(contentType.includes("spreadsheetml.sheet"), `Unexpected export content type: ${contentType}`);
  assert(bytes.length > 1000, `Exported file is unexpectedly small: ${bytes.length} bytes`);
  return {
    contentType,
    bytes: bytes.length
  };
}

async function main() {
  const defaultRules = await checkDefaultRules();
  const output = {
    baseUrl,
    serverStatus: await checkServer(),
    health: await checkHealth(),
    defaultRules: defaultRules.map((rule) => rule.name),
    demoParsing: await checkDemoParsing(),
    syntheticComplexFormats: await checkSyntheticComplexFormats(defaultRules),
    performance: await checkPerformance(),
    export: await checkExport(),
    submitAndHistory: await checkSubmitAndHistory()
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
