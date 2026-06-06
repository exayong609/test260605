import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
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

async function checkRuleCrud() {
  const id = `smoke_rule_${Date.now()}`;
  const now = new Date().toISOString();
  const rule = {
    id,
    name: "SMOKE temporary rule",
    description: "Temporary rule created by smoke test",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: now,
    updatedAt: now,
    headerRowIndex: 0,
    dataStartRowIndex: 1,
    mappings: [
      { kind: "column", field: "externalCode", columnIndex: 0 },
      { kind: "column", field: "storeName", columnIndex: 1 },
      { kind: "column", field: "skuCode", columnIndex: 5 },
      { kind: "column", field: "skuName", columnIndex: 6 },
      { kind: "column", field: "skuQuantity", columnIndex: 7 }
    ]
  };

  try {
    const createResponse = await fetch(`${baseUrl}/api/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rule)
    });
    const created = await readJson(createResponse);
    assert(createResponse.ok, "Rule create API failed");
    assert(created.rule?.id === id, "Created rule id mismatch");

    const listAfterCreateResponse = await fetch(`${baseUrl}/api/rules`, { cache: "no-store" });
    const listAfterCreate = await readJson(listAfterCreateResponse);
    assert(listAfterCreateResponse.ok, "Rule list after create failed");
    assert((listAfterCreate.rules || []).some((item) => item.id === id), "Created rule was not listed");

    const updateResponse = await fetch(`${baseUrl}/api/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...rule, name: "SMOKE temporary rule updated" })
    });
    const updated = await readJson(updateResponse);
    assert(updateResponse.ok, "Rule update API failed");
    assert(updated.rule?.name === "SMOKE temporary rule updated", "Updated rule name mismatch");
  } finally {
    await fetch(`${baseUrl}/api/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  const listAfterDeleteResponse = await fetch(`${baseUrl}/api/rules`, { cache: "no-store" });
  const listAfterDelete = await readJson(listAfterDeleteResponse);
  assert(listAfterDeleteResponse.ok, "Rule list after delete failed");
  assert(!(listAfterDelete.rules || []).some((item) => item.id === id), "Temporary rule was not deleted");

  return {
    id,
    created: true,
    updated: true,
    deleted: true
  };
}

async function checkLlmProfileCrud() {
  const id = `smoke_profile_${Date.now()}`;
  const now = new Date().toISOString();
  const profile = {
    id,
    name: "SMOKE temporary profile",
    protocol: "openai-compatible",
    baseUrl: "https://example.invalid/v1",
    model: "smoke-model",
    apiKey: "smoke-test-key-not-real",
    temperature: 0,
    timeoutMs: 1000,
    enabled: false,
    createdAt: now,
    updatedAt: now
  };

  try {
    const createResponse = await fetch(`${baseUrl}/api/llm-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile)
    });
    const created = await readJson(createResponse);
    assert(createResponse.ok, "LLM profile create API failed");
    assert(created.profile?.id === id, "Created profile id mismatch");
    assert(created.profile?.hasApiKey === true, "Created profile did not report saved key");
    assert(!("apiKey" in (created.profile || {})), "Profile API leaked apiKey on create");

    const listAfterCreateResponse = await fetch(`${baseUrl}/api/llm-profiles`, { cache: "no-store" });
    const listAfterCreate = await readJson(listAfterCreateResponse);
    const listed = (listAfterCreate.profiles || []).find((item) => item.id === id);
    assert(listAfterCreateResponse.ok, "LLM profile list after create failed");
    assert(listed, "Created profile was not listed");
    assert(!("apiKey" in listed), "Profile list leaked apiKey");

    const updateResponse = await fetch(`${baseUrl}/api/llm-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...profile, name: "SMOKE temporary profile updated", apiKey: "", keepExistingKey: true })
    });
    const updated = await readJson(updateResponse);
    assert(updateResponse.ok, "LLM profile update API failed");
    assert(updated.profile?.name === "SMOKE temporary profile updated", "Updated profile name mismatch");
    assert(updated.profile?.hasApiKey === true, "Profile update did not keep existing key");
    assert(!("apiKey" in (updated.profile || {})), "Profile API leaked apiKey on update");
  } finally {
    await fetch(`${baseUrl}/api/llm-profiles?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  const listAfterDeleteResponse = await fetch(`${baseUrl}/api/llm-profiles`, { cache: "no-store" });
  const listAfterDelete = await readJson(listAfterDeleteResponse);
  assert(listAfterDeleteResponse.ok, "LLM profile list after delete failed");
  assert(!(listAfterDelete.profiles || []).some((item) => item.id === id), "Temporary LLM profile was not deleted");

  return {
    id,
    created: true,
    updated: true,
    deleted: true,
    apiKeyHidden: true
  };
}

async function checkDemoParsing() {
  const demosDir = path.join(process.cwd(), "demos");
  const files = fs.existsSync(demosDir)
    ? fs.readdirSync(demosDir).filter((file) => /\.(xlsx|xls|pdf|docx)$/i.test(file) && !file.startsWith("~$"))
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

async function checkStandardRuleWithNoisyHeader(defaultRules) {
  const rule = defaultRules.find((item) => item.id === "template_tabular_standard");
  assert(rule, "Standard tabular default rule is missing");
  const demosDir = path.join(process.cwd(), "demos");
  const files = fs.readdirSync(demosDir).filter((item) => /\.(xlsx|xls)$/i.test(item) && !item.startsWith("~$"));
  assert(files.length > 0, "No Excel demo found for standard rule check");

  let matched;
  for (const candidate of files) {
    const parsed = await postFile("/api/parse", path.join(demosDir, candidate), {
      rule: JSON.stringify(rule)
    });
    assert(parsed.response.ok, `Standard tabular rule parse API failed for ${candidate}`);
    const rows = parsed.data.result?.rows || [];
    const issues = parsed.data.result?.issues || [];
    const hasTailRecipient = rows.length > 0 && rows.every((row) => row.recipientPhone && row.recipientAddress);
    const hasSharedExternalCode = rows.length > 1 && rows.every((row) => row.externalCode === rows[0].externalCode);
    if (issues.length === 0 && hasTailRecipient && hasSharedExternalCode) {
      matched = { file: candidate, rows, issues };
      break;
    }
  }

  assert(matched, "Standard rule did not parse any demo with shared external code and tail recipient info");
  const rows = matched.rows;
  assert(rows.every((row) => row.skuCode && row.skuName && row.skuQuantity > 0), "Standard rule produced incomplete SKU rows");
  return {
    file: matched.file,
    rows: rows.length,
    externalCode: rows[0]?.externalCode,
    recipientPhone: rows[0]?.recipientPhone
  };
}

async function checkEmptyParseIssue() {
  const demosDir = path.join(process.cwd(), "demos");
  const file = fs.readdirSync(demosDir).find((item) => /\.(xlsx|xls)$/i.test(item) && !item.startsWith("~$"));
  assert(file, "No Excel demo file found for empty parse check");
  const badRule = {
    id: "smoke_bad_empty_rule",
    name: "Smoke bad empty rule",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    headerRowIndex: 0,
    dataStartRowIndex: 1,
    dataEndRowIndex: 2,
    mappings: [
      { kind: "column", field: "skuCode", columnIndex: 80 },
      { kind: "column", field: "skuName", columnIndex: 81 },
      { kind: "column", field: "skuQuantity", columnIndex: 82 }
    ]
  };
  const parsed = await postFile("/api/parse", path.join(demosDir, file), {
    rule: JSON.stringify(badRule)
  });
  const issueIds = (parsed.data.result?.issues || []).map((issue) => issue.id);
  assert(parsed.response.ok, "Empty parse check API failed");
  assert(parsed.data.result?.rows?.length === 0, "Bad rule unexpectedly parsed rows");
  assert(issueIds.includes("parse_empty_result"), "Empty parse did not report parse_empty_result");
  return {
    file,
    rows: parsed.data.result.rows.length,
    issueIds
  };
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function docxBuffer(lines) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${lines.map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`).join("\n    ")}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
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

async function parseSyntheticDocx(fileName, lines, rule) {
  const parsed = await postBuffer(
    "/api/parse",
    fileName,
    await docxBuffer(lines),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    { rule: JSON.stringify(rule) }
  );
  assert(parsed.response.ok, `Synthetic DOCX parse failed for ${fileName}`);
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

async function checkSyntheticWordAndMultiOrderText() {
  const textRule = {
    id: "smoke_word_text_rule",
    name: "Smoke Word pure text rule",
    sourceKind: "word",
    layout: "textBlocks",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sectionSeparatorPattern: "\\n\\s*\\n",
    itemLinePattern: "(?:\\d+[\\.]\\s*)?([A-Za-z0-9_-]{2,})\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*(\\d+(?:\\.\\d+)?)",
    mappings: [
      { kind: "regex", field: "externalCode", pattern: "(?:Order No|Order)[:\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "document" },
      { kind: "regex", field: "storeName", pattern: "Store[:\\s]*([^\\n]+)", group: 1, scope: "document" },
      { kind: "regex", field: "recipientName", pattern: "Receiver[:\\s]*([^\\n]+)", group: 1, scope: "document" },
      { kind: "regex", field: "recipientPhone", pattern: "Phone[:\\s]*([0-9\\-\\s]{7,20})", group: 1, scope: "document" },
      { kind: "regex", field: "recipientAddress", pattern: "Address[:\\s]*([^\\n]+)", group: 1, scope: "document" }
    ]
  };

  const wordResult = await parseSyntheticDocx(
    "synthetic-word-text.docx",
    [
      "Order No: WORD-001",
      "Store: Alpha Store",
      "Receiver: Alice",
      "Phone: 13812345678",
      "Address: Alpha Road 1",
      "1. SKU-WORD-1 | Tomato | 500g | 2",
      "2. SKU-WORD-2 | Potato | 1kg | 3"
    ],
    textRule
  );
  assert(wordResult.rows.length === 2, `Expected 2 Word text rows, got ${wordResult.rows.length}`);
  assert(wordResult.groups.length === 1, `Expected 1 Word text order, got ${wordResult.groups.length}`);
  assert(wordResult.issues.length === 0, `Expected no Word text issues, got ${wordResult.issues.length}`);

  const multiOrderRule = {
    ...textRule,
    id: "smoke_multi_order_text_rule",
    name: "Smoke multi-order text rule",
    layout: "multiSection",
    sectionStartPattern: "Delivery Order",
    mappings: [
      { kind: "regex", field: "externalCode", pattern: "Delivery Order[:\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "section" },
      { kind: "regex", field: "storeName", pattern: "Store[:\\s]*([^\\n]+)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientName", pattern: "Receiver[:\\s]*([^\\n]+)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientPhone", pattern: "Phone[:\\s]*([0-9\\-\\s]{7,20})", group: 1, scope: "section" },
      { kind: "regex", field: "recipientAddress", pattern: "Address[:\\s]*([^\\n]+)", group: 1, scope: "section" }
    ]
  };
  const multiOrderResult = await parseSyntheticDocx(
    "synthetic-multi-order-text.docx",
    [
      "Delivery Order: TXT-001",
      "Store: North Store",
      "Receiver: Bob",
      "Phone: 13912345678",
      "Address: North Road",
      "1. SKU-MULTI-1 | Apple | box | 2",
      "2. SKU-MULTI-2 | Pear | box | 1",
      "-----",
      "Delivery Order: TXT-002",
      "Store: South Store",
      "Receiver: Cindy",
      "Phone: 13712345678",
      "Address: South Road",
      "1. SKU-MULTI-3 | Banana | bag | 4"
    ],
    multiOrderRule
  );
  assert(multiOrderResult.rows.length === 3, `Expected 3 multi-order text rows, got ${multiOrderResult.rows.length}`);
  assert(multiOrderResult.groups.length === 2, `Expected 2 multi-order text orders, got ${multiOrderResult.groups.length}`);
  assert(multiOrderResult.issues.length === 0, `Expected no multi-order text issues, got ${multiOrderResult.issues.length}`);

  return {
    wordPureText: {
      rows: wordResult.rows.length,
      groups: wordResult.groups.length,
      sample: wordResult.rows.map((row) => `${row.externalCode}:${row.skuCode}:${row.skuQuantity}`)
    },
    multiOrderText: {
      rows: multiOrderResult.rows.length,
      groups: multiOrderResult.groups.length,
      orders: multiOrderResult.groups.map((group) => group.externalCode)
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

  const duplicateHistoryResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows })
  });
  const duplicateHistory = await readJson(duplicateHistoryResponse);
  assert(!duplicateHistoryResponse.ok, "Historical external-code duplicate was accepted");
  assert(
    (duplicateHistory.issues || []).some((issue) => String(issue.id || "").includes("external_duplicate_existing")),
    "Historical external-code duplicate was not reported"
  );

  const batchConflictCode = `${externalCode}-BATCH`;
  const batchConflictRows = [
    {
      id: `${batchConflictCode}-1`,
      rowNumber: 1,
      externalCode: batchConflictCode,
      storeName: "Smoke Store",
      skuCode: "SKU-BATCH-1",
      skuName: "Smoke Batch Item 1",
      skuQuantity: 1
    },
    {
      id: `${batchConflictCode}-2`,
      rowNumber: 2,
      externalCode: batchConflictCode,
      storeName: "Smoke Store",
      skuCode: "SKU-BATCH-1",
      skuName: "Smoke Batch Item 1 Duplicate",
      skuQuantity: 1
    }
  ];
  const batchConflictResponse = await fetch(`${baseUrl}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows: batchConflictRows })
  });
  const batchConflict = await readJson(batchConflictResponse);
  assert(!batchConflictResponse.ok, "Batch external-code conflict was accepted");
  assert(
    (batchConflict.issues || []).some((issue) => String(issue.id || "").includes("external_duplicate_batch")),
    "Batch external-code conflict was not reported"
  );

  return {
    externalCode,
    successCount: submitted.successCount,
    failureCount: submitted.failureCount,
    historyTotal: history.total,
    historicalDuplicateRejected: true,
    batchDuplicateRejected: true
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
    ruleCrud: await checkRuleCrud(),
    llmProfileCrud: await checkLlmProfileCrud(),
    demoParsing: await checkDemoParsing(),
    standardRuleNoisyHeader: await checkStandardRuleWithNoisyHeader(defaultRules),
    emptyParseIssue: await checkEmptyParseIssue(),
    syntheticComplexFormats: await checkSyntheticComplexFormats(defaultRules),
    syntheticWordAndMultiOrderText: await checkSyntheticWordAndMultiOrderText(),
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
