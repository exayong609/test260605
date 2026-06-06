import { inferRuleFromDocument } from "@/lib/rule-inference";
import { executeRule } from "@/lib/rule-engine";
import type { FieldMapping, IntermediateDocument, LlmProfile, LlmProtocol, OrderField, ParsingRule } from "@/types";

export const RULE_SYSTEM_PROMPT = `你是物流批量下单系统的“解析规则设计助手”。你的任务是根据上传文件的结构样本，生成一份可被规则引擎执行的 ParsingRule JSON。注意：你生成的是解析规则，不是直接解析后的订单数据。
直接输出最终 JSON，不要输出分析过程、解释文本、Markdown、代码块或思考内容。description 和 assumptions 必须短句化，优先保证 JSON 完整、可解析、可执行。

业务目标字段只允许使用：
- externalCode: 外部编码/配送单号/订单号，可为空
- storeName: 收货门店/机构
- recipientName: 收件人姓名
- recipientPhone: 收件人电话
- recipientAddress: 收件人地址
- skuCode: SKU 物品编码，必填
- skuName: SKU 物品名称，必填
- skuQuantity: SKU 发货数量，必填且为正数
- skuSpec: SKU 规格型号，可为空
- remark: 备注，可为空

收货信息校验规则：
- A 组：storeName 有值即可。
- B 组：recipientName + recipientPhone + recipientAddress 三者都有值即可。
- A 组和 B 组可以同时存在，但至少满足一组。

规则 JSON schema：
{
  "name": "规则名称",
  "description": "规则说明",
  "sourceKind": "excel|word|pdf|unknown|any",
  "layout": "tabular|matrix|cards|textBlocks|multiSection",
  "sheetMode": "first|all",
  "headerRowIndex": 0,
  "dataStartRowIndex": 1,
  "dataEndRowIndex": 99,
  "stopWhenRowMatches": "合计|总计|小计",
  "skipRowPatterns": ["合计", "总计"],
  "sectionStartPattern": "调拨记录|配送签收单",
  "sectionSeparatorPattern": "分隔正则",
  "itemLinePattern": "物品行正则，至少捕获 skuCode/skuName/skuSpec/skuQuantity",
  "matrix": {
    "headerRowIndex": 1,
    "dataStartRowIndex": 2,
    "fixedColumns": { "skuCode": 0, "skuName": 1, "skuSpec": 2 },
    "matrixStartColumnIndex": 3,
    "matrixEndColumnIndex": 10,
    "compoundSeparatorPattern": "\\n|；|;"
  },
  "groupBy": "externalCode",
  "mappings": [],
  "assumptions": ["明确说明哪些字段映射是推测的，需要用户确认"],
  "confidence": 0.86
}

mapping 只允许以下 kind：
- column: {"kind":"column","field":"skuCode","columnIndex":0}，用于表格列映射。优先使用 columnIndex，因为样本中有列号。
- cell: {"kind":"cell","field":"recipientName","rowIndex":8,"columnIndex":2}，用于固定单元格或尾部散落信息。
- regex: {"kind":"regex","field":"recipientPhone","pattern":"电话[:：\\s]*([0-9\\-\\s]{7,20})","group":1,"scope":"document|section|tail"}，用于文本/PDF/卡片区块。
- constant: {"kind":"constant","field":"remark","value":"固定值"}。
- sheetName: {"kind":"sheetName","field":"storeName"}，用于每个 Sheet 代表一个门店。
- matrixColumn: {"kind":"matrixColumn","field":"storeName"}，用于矩阵列头代表门店/日期等业务维度。
- compoundPart: {"kind":"compoundPart","field":"skuName","part":"name"} 或 {"kind":"compoundPart","field":"skuQuantity","part":"quantity"}，用于复合单元格拆分。

布局选择建议：
- tabular: 标准表格、头部干扰、尾部固定收货信息、多 Sheet 同构表格。
- matrix: 门店名/日期等在列头横向展开，数量在交叉单元格中。
- cards: 多个卡片式区块，每个区块包含独立收货信息和物品小表。
- textBlocks/multiSection: Word/PDF 纯文本、多订单 PDF、按分隔符拆段后再抽取。

硬性要求：
1. 不得依赖文件名判断业务含义。
2. 不要输出订单数据，只输出规则。
3. 所有行号、列号都使用 0 基索引。
4. dataEndRowIndex 和 matrixEndColumnIndex 都是“排他结束索引”，循环会在 index < end 时停止；如果不确定最后一行/列，请省略结束索引并依赖 stopWhenRowMatches/skipRowPatterns，不能截断有效业务行。
5. 不要把合计/小计/说明行解析成 SKU 行。
6. 如果收货信息在数据区外，使用 cell 或 regex 单独抽取。
7. 如果同一外部编码有多个 SKU 行，保留多行，由系统聚合，不要合并 SKU。
8. 文件样本中会提供本地推荐规则的试解析指标和样例行。你可以优化规则，但不要比参考结果少解析有效 SKU 行。
9. 必须填写 assumptions，标注所有推测映射。
10. description、name、assumptions 等字符串内部不要使用英文双引号；需要强调词语时用中文书名号或不加引号，避免 JSON 字符串被截断。
11. cards/textBlocks/multiSection 的 itemLinePattern 必须至少有 4 个捕获组，顺序为 skuCode、skuName、skuSpec、skuQuantity；不要匹配表头、合计、收货人、电话、地址、调拨记录标题。
12. 最终回答只能是一个合法 JSON 对象，不要 Markdown，不要代码块，不要注释，不要尾随逗号。
13. 如果 fallbackRuleForSchemaReference 已能稳定解析，只做必要的小修正；不需要复述文件结构分析。`;

type RuntimeLlmProfile = Partial<Pick<LlmProfile, "protocol" | "baseUrl" | "model" | "apiKey" | "temperature" | "timeoutMs">> & {
  prompt?: string;
  disableEnvFallback?: boolean;
};

type LlmCallResult = {
  content: string;
  payload: unknown;
  status: number;
  endpoint: string;
  protocol: LlmProtocol;
  model: string;
};

const ORDER_FIELDS: OrderField[] = [
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

const FIELD_SET = new Set<string>(ORDER_FIELDS);
const MAPPING_KINDS = new Set(["column", "cell", "regex", "constant", "sheetName", "matrixColumn", "compoundPart"]);

const RULE_QUALITY_PROMPT = `质量闸门补充要求：
14. 优先贴合 fallbackRuleForSchemaReference；只有能保持或提升 fallbackSelfTestReference 的行数、错误数和字段覆盖时才调整。
15. tabular 场景必须准确区分表头、明细、合计和尾部信息；dataStartRowIndex 必须指向第一条真实 SKU 明细，不要把标题、说明、制单、打印次数、收货信息行当作 SKU。
16. 如果 fallbackSelfTestReference.rows 很少，不要扩大数据区来凑行数；宁可保持参考规则，也不要多抽非明细行。
17. cards/textBlocks/multiSection 的 regex scope 必须谨慎：区块内门店、收货人、电话、地址使用 scope=section；整份文档共用字段才使用 scope=document。
18. SKU 规格必须映射到 skuSpec，发货数量必须映射到 skuQuantity；不要把 750ml、2.5kg、25kg 等规格数字当作数量。
19. 如果 itemLinePattern 提取不到 skuSpec，应调整正则的第 3 个捕获组，而不是省略 skuSpec 映射。
20. 若 fallback 试解析为 0 错误，AI 规则也必须做到 0 错误、关键字段覆盖不下降、数量签名不偏移。`;

const RULE_REPAIR_PROMPT = `你刚才生成的规则没有通过服务端自检。现在只做规则修正：
1. 必须根据 rejectionReasons 修复具体问题。
2. 不要扩大数据区，不要把非 SKU 明细行解析成 SKU。
3. 如果 fallbackRuleForSchemaReference 已经是 0 错误且字段覆盖完整，可以直接返回与 fallbackRuleForSchemaReference 等价的规则。
4. 仍然只输出合法 ParsingRule JSON。`;

const RULE_JSON_REPAIR_PROMPT = `你刚才输出的内容不是合法 JSON。现在只做 JSON 修正和规则结构修正：
1. 返回一个合法 ParsingRule JSON 对象，不要 Markdown，不要解释。
2. 不要在字符串内部使用未转义的英文双引号。
3. 可以直接返回与 fallbackRuleForSchemaReference 等价的规则，但必须保持字段白名单和 mapping kind 白名单。
4. 修正后的规则仍必须满足 fallbackSelfTestReference 的质量下限。`;

function normalizeProtocol(protocol?: string): LlmProtocol {
  if (protocol === "minimax-native") return "minimax-native";
  return protocol === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
}

function isMiniMaxBase(baseUrl: string) {
  const clean = baseUrl.toLowerCase();
  return clean.includes("api.minimaxi.com") || clean.includes("api.minimax.io");
}

function normalizeCompare(value: unknown) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function resolveProtocol(protocol: LlmProtocol, baseUrl: string, model?: string): LlmProtocol {
  const clean = baseUrl.toLowerCase();
  if (/^minimax-m3$/i.test(model || "") && isMiniMaxBase(clean)) return "minimax-native";
  if (clean.includes("chatcompletion_v2")) return "minimax-native";
  if (clean.includes("/anthropic") || clean.endsWith("/messages") || clean.includes("/v1/messages")) return "anthropic-compatible";
  if (clean.endsWith("/chat/completions") || clean.includes("/v1/chat/completions")) return "openai-compatible";
  return protocol;
}

function openAiEndpoint(baseUrl: string) {
  const clean = baseUrl.replace(/\/$/, "");
  if (clean.endsWith("/chat/completions")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/chat/completions`;
  return `${clean}/v1/chat/completions`;
}

function anthropicEndpoint(baseUrl: string) {
  const clean = baseUrl.replace(/\/$/, "");
  if (clean.endsWith("/messages")) return clean;
  if (clean.endsWith("/anthropic")) return `${clean}/v1/messages`;
  if (isMiniMaxBase(clean) && !clean.includes("/anthropic")) return `${clean}/anthropic/v1/messages`;
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

function miniMaxNativeEndpoint(baseUrl: string) {
  const clean = baseUrl.replace(/\/$/, "");
  if (clean.endsWith("/chatcompletion_v2")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/text/chatcompletion_v2`;
  return `${clean}/v1/text/chatcompletion_v2`;
}

function llmEndpoint(protocol: LlmProtocol, baseUrl: string) {
  if (protocol === "minimax-native") return miniMaxNativeEndpoint(baseUrl);
  return protocol === "anthropic-compatible" ? anthropicEndpoint(baseUrl) : openAiEndpoint(baseUrl);
}

function anthropicHeaders(apiKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    "X-Api-Key": apiKey,
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01"
  };
}

function rulePreview(rule: ParsingRule, document: IntermediateDocument) {
  const result = executeRule(document, rule);
  return {
    rows: result.rows.length,
    groups: result.groups.length,
    errors: result.issues.filter((issue) => issue.severity === "error").length,
    warnings: result.issues.filter((issue) => issue.severity === "warning").length,
    sampleRows: result.rows.slice(0, 5).map((row) => ({
      externalCode: row.externalCode,
      storeName: row.storeName,
      recipientName: row.recipientName,
      recipientPhone: row.recipientPhone,
      recipientAddress: row.recipientAddress,
      skuCode: row.skuCode,
      skuName: row.skuName,
      skuQuantity: row.skuQuantity,
      sourceSheet: row.sourceSheet,
      sourceSection: row.sourceSection
    })),
    lastRow: result.rows.at(-1)
      ? {
          externalCode: result.rows.at(-1)?.externalCode,
          storeName: result.rows.at(-1)?.storeName,
          skuCode: result.rows.at(-1)?.skuCode,
          skuName: result.rows.at(-1)?.skuName,
          skuQuantity: result.rows.at(-1)?.skuQuantity,
          sourceSheet: result.rows.at(-1)?.sourceSheet,
          sourceSection: result.rows.at(-1)?.sourceSection
        }
      : null
  };
}

function compactRule(rule: ParsingRule) {
  return {
    sourceKind: rule.sourceKind,
    layout: rule.layout,
    sheetMode: rule.sheetMode,
    headerRowIndex: rule.headerRowIndex,
    dataStartRowIndex: rule.dataStartRowIndex,
    dataEndRowIndex: rule.dataEndRowIndex,
    stopWhenRowMatches: rule.stopWhenRowMatches,
    skipRowPatterns: rule.skipRowPatterns,
    sectionStartPattern: rule.sectionStartPattern,
    sectionSeparatorPattern: rule.sectionSeparatorPattern,
    itemLinePattern: rule.itemLinePattern,
    matrix: rule.matrix,
    groupBy: rule.groupBy,
    mappings: rule.mappings
  };
}

function sampleRows(rows: string[][], start: number, count: number) {
  return rows.slice(start, start + count).map((row, rowIndex) => ({
    rowIndex: start + rowIndex,
    cells: row.map((cell, columnIndex) => ({ columnIndex, value: cell })).filter((cell) => cell.value)
  }));
}

function compactDocumentForLlm(document: IntermediateDocument) {
  const sheetSamples = document.sheets.slice(0, 5).map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rows.length,
    headRows: sampleRows(sheet.rows, 0, 16),
    tailRows: sampleRows(sheet.rows, Math.max(0, sheet.rows.length - 10), 10)
  }));
  const lines = document.text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  return {
    sourceKind: document.sourceKind,
    stats: document.stats,
    sheets: sheetSamples,
    textHead: lines.slice(0, 80),
    textTail: lines.slice(-60)
  };
}

function userRulePayload(document: IntermediateDocument, fallback: ParsingRule) {
  return JSON.stringify({
    file: compactDocumentForLlm(document),
    fallbackRuleForSchemaReference: compactRule(fallback),
    fallbackSelfTestReference: rulePreview(fallback, document),
    instruction:
      "请参考 fallbackRuleForSchemaReference 的结构和可执行 DSL，只在你确认样本结构更合理时调整行列号、布局、正则和映射。返回结果必须能被该规则引擎执行，且不要少于 fallbackSelfTestReference.rows 的有效 SKU 行。请输出紧凑 JSON，description 和 assumptions 保持短句。"
  });
}

function repairRulePayload(params: {
  document: IntermediateDocument;
  fallback: ParsingRule;
  rejectedRule: ParsingRule;
  rejectedQuality: ReturnType<typeof resultQuality>;
  fallbackQuality: ReturnType<typeof resultQuality>;
  reasons: string[];
}) {
  return JSON.stringify({
    file: compactDocumentForLlm(params.document),
    fallbackRuleForSchemaReference: compactRule(params.fallback),
    fallbackSelfTestReference: rulePreview(params.fallback, params.document),
    rejectedRule: compactRule(params.rejectedRule),
    rejectedQuality: {
      rows: params.rejectedQuality.rows,
      groups: params.rejectedQuality.groups,
      errorCount: params.rejectedQuality.errorCount,
      criticalEmptyCount: params.rejectedQuality.criticalEmptyCount,
      fieldCoverage: params.rejectedQuality.fieldCoverage,
      quantityMismatchCount: quantityMismatchCount(params.rejectedQuality, params.fallbackQuality),
      losesUsefulFieldCoverage: losesUsefulFieldCoverage(params.rejectedQuality, params.fallbackQuality)
    },
    rejectionReasons: params.reasons,
    instruction:
      "请只修正 rejectedRule 的行列号、布局、正则和映射，使它达到 fallbackSelfTestReference 的质量下限。若无法更优，请返回与 fallbackRuleForSchemaReference 等价的规则 JSON。"
  });
}

function jsonRepairRulePayload(params: { document: IntermediateDocument; fallback: ParsingRule; badContent: string; parseError: string }) {
  return JSON.stringify({
    file: compactDocumentForLlm(params.document),
    fallbackRuleForSchemaReference: compactRule(params.fallback),
    fallbackSelfTestReference: rulePreview(params.fallback, params.document),
    invalidModelOutputPreview: params.badContent.slice(0, 6000),
    jsonParseError: params.parseError,
    instruction:
      "请把 invalidModelOutputPreview 修成合法 ParsingRule JSON；如果内容损坏严重，请直接返回 fallbackRuleForSchemaReference 等价规则。"
  });
}

function parseMaybeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function miniMaxBaseError(payload: unknown) {
  const baseResp = (payload as { base_resp?: { status_code?: unknown; status_msg?: unknown } }).base_resp;
  if (!baseResp) return "";
  const statusCode = typeof baseResp.status_code === "number" ? baseResp.status_code : 0;
  if (statusCode === 0) return "";
  const statusMsg = typeof baseResp.status_msg === "string" ? baseResp.status_msg : "MiniMax API call failed";
  return `MiniMax ${statusCode}: ${statusMsg}`;
}

function extractOpenAiText(payload: unknown) {
  const choice = (payload as { choices?: unknown[] }).choices?.[0] as
    | { message?: { content?: unknown }; messages?: { content?: unknown }[]; text?: unknown; delta?: { content?: unknown } }
    | undefined;
  const content = choice?.message?.content ?? choice?.messages?.[0]?.content ?? choice?.text ?? choice?.delta?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  const reply = (payload as { reply?: unknown; output?: unknown; text?: unknown }).reply ?? (payload as { output?: unknown }).output ?? (payload as { text?: unknown }).text;
  return typeof reply === "string" ? reply : "";
}

function extractAnthropicText(payload: unknown) {
  const content = (payload as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function extractLlmText(protocol: LlmProtocol, payload: unknown) {
  return protocol === "anthropic-compatible" ? extractAnthropicText(payload) : extractOpenAiText(payload);
}

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1] || text.match(/```\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  try {
    return JSON.parse(raw);
  } catch {
    return JSON.parse(repairLikelyJsonStringQuotes(raw));
  }
}

function repairLikelyJsonStringQuotes(raw: string) {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (!inString) {
      output += char;
      if (char === "\"") inString = true;
      continue;
    }

    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char !== "\"") {
      output += char;
      continue;
    }

    const next = raw.slice(index + 1).match(/^\s*([,}\]:])/);
    if (next) {
      output += char;
      inString = false;
    } else {
      output += "\\\"";
    }
  }

  return output;
}

function responsePreview(payload: unknown, rawText: string, content: string) {
  const baseResp = (payload as { base_resp?: unknown })?.base_resp;
  return {
    base_resp: baseResp,
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload as Record<string, unknown>) : [],
    contentLength: content.length,
    contentPreview: content.slice(0, 800),
    rawPreview: rawText.slice(0, 800)
  };
}

function logLlmResponse(context: "test" | "generate", meta: Omit<LlmCallResult, "content"> & { rawText: string; content: string }) {
  console.info(
    `[llm:${context}]`,
    JSON.stringify(
      {
        protocol: meta.protocol,
        model: meta.model,
        endpoint: meta.endpoint,
        httpStatus: meta.status,
        ...responsePreview(meta.payload, meta.rawText, meta.content)
      },
      null,
      2
    )
  );
}

function logLlmStart(context: "test" | "generate", meta: { protocol: LlmProtocol; model: string; endpoint: string; timeoutMs: number; bodyBytes: number }) {
  console.info(`[llm:${context}:start]`, JSON.stringify(meta, null, 2));
}

function logLlmError(context: "test" | "generate", meta: { protocol: LlmProtocol; model: string; endpoint: string; message: string }) {
  console.warn(`[llm:${context}:error]`, JSON.stringify(meta, null, 2));
}

async function callLlm(params: {
  context: "test" | "generate";
  protocol: LlmProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature?: number;
  timeoutMs: number;
  prompt?: string;
  userContent: string;
  maxTokens?: number;
}) {
  const endpoint = llmEndpoint(params.protocol, params.baseUrl);
  const isMiniMaxM3 = /^minimax-m3$/i.test(params.model) && isMiniMaxBase(params.baseUrl);
  const body =
    params.protocol === "anthropic-compatible"
      ? {
          model: params.model,
          temperature: params.temperature ?? 0,
          max_tokens: params.maxTokens ?? 1024,
          ...(isMiniMaxM3 ? { thinking: { type: "disabled" } } : {}),
          system: params.prompt,
          messages: [{ role: "user", content: params.userContent }]
        }
      : params.protocol === "minimax-native"
        ? {
            model: params.model,
            temperature: params.temperature ?? 0,
            ...(isMiniMaxM3 ? { thinking: { type: "disabled" }, reasoning_split: false } : {}),
            ...(params.maxTokens ? { max_completion_tokens: params.maxTokens } : {}),
            messages: [
              ...(params.prompt ? [{ role: "system", name: "rule_designer", content: params.prompt }] : []),
              { role: "user", name: "user", content: params.userContent }
            ]
          }
        : {
            model: params.model,
            temperature: params.temperature ?? 0,
            ...(isMiniMaxM3 ? { thinking: { type: "disabled" }, reasoning_split: false } : {}),
            ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
            messages: [
              ...(params.prompt ? [{ role: "system", content: params.prompt }] : []),
              { role: "user", content: params.userContent }
            ]
          };

  const requestBody = JSON.stringify(body);
  logLlmStart(params.context, {
    protocol: params.protocol,
    model: params.model,
    endpoint,
    timeoutMs: params.timeoutMs,
    bodyBytes: Buffer.byteLength(requestBody)
  });

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers:
        params.protocol === "anthropic-compatible"
          ? anthropicHeaders(params.apiKey)
          : {
              "Content-Type": "application/json",
              Authorization: `Bearer ${params.apiKey}`
            },
      body: requestBody,
      signal: AbortSignal.timeout(params.timeoutMs)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "LLM request failed";
    logLlmError(params.context, { protocol: params.protocol, model: params.model, endpoint, message });
    throw error;
  }

  const rawText = await response.text();
  const payload = parseMaybeJson(rawText);
  const content = payload ? extractLlmText(params.protocol, payload) : "";
  logLlmResponse(params.context, {
    status: response.status,
    protocol: params.protocol,
    model: params.model,
    endpoint,
    payload,
    rawText,
    content
  });

  if (!response.ok) throw new Error(rawText ? `HTTP ${response.status}: ${rawText.slice(0, 360)}` : `HTTP ${response.status}`);
  const baseError = payload ? miniMaxBaseError(payload) : "";
  if (baseError) throw new Error(baseError);
  if (!payload) throw new Error(rawText ? `模型返回非 JSON：${rawText.slice(0, 220)}` : "模型返回为空");
  return { content, payload, status: response.status, endpoint, protocol: params.protocol, model: params.model };
}

export async function testLlmProfile(profile: RuntimeLlmProfile) {
  const apiKey = profile.apiKey?.trim() || process.env.LLM_API_KEY;
  if (!apiKey) throw new Error("缺少 API Key");

  const baseUrl = profile.baseUrl?.trim() || process.env.LLM_BASE_URL || "https://api.deepseek.com";
  const model = profile.model?.trim() || process.env.LLM_MODEL || "deepseek-chat";
  const protocol = resolveProtocol(normalizeProtocol(profile.protocol || process.env.LLM_PROTOCOL), baseUrl, model);
  const result = await callLlm({
    context: "test",
    protocol,
    baseUrl,
    model,
    apiKey,
    temperature: profile.temperature ?? 0,
    timeoutMs: profile.timeoutMs ?? 15000,
    userContent: "请回复一个很短的 JSON：{\"ok\":true}。不要解释。",
    maxTokens: 256
  });
  return {
    ok: true,
    model,
    protocol,
    endpoint: result.endpoint,
    contentReturned: Boolean(result.content),
    warning: result.content ? undefined : "API 已成功响应，但模型本次返回文本为空。规则生成会继续通过服务端自检兜底。"
  };
}

function fallbackResult(fallback: ParsingRule, reason: string): { rule: ParsingRule; provider: "fallback" } {
  return {
    rule: { ...fallback, assumptions: [...(fallback.assumptions || []), reason] },
    provider: "fallback"
  };
}

function buildRulePrompt(userPrompt?: string) {
  const trimmed = userPrompt?.trim();
  const basePrompt = `${RULE_SYSTEM_PROMPT}

${RULE_QUALITY_PROMPT}`;
  if (!trimmed || trimmed === RULE_SYSTEM_PROMPT.trim()) return basePrompt;
  return `${RULE_SYSTEM_PROMPT}

${RULE_QUALITY_PROMPT}

用户补充要求：
${trimmed}

再次强调：不要输出分析过程，最终只返回一个合法 JSON 对象。`;
}

function sanitizeMappings(mappings: unknown, fallback: FieldMapping[]) {
  if (!Array.isArray(mappings)) return fallback;
  const cleaned = mappings.filter((mapping): mapping is FieldMapping => {
    if (!mapping || typeof mapping !== "object") return false;
    const candidate = mapping as { kind?: unknown; field?: unknown };
    return typeof candidate.kind === "string" && MAPPING_KINDS.has(candidate.kind) && typeof candidate.field === "string" && FIELD_SET.has(candidate.field);
  });
  return cleaned.length ? cleaned : fallback;
}

function normalizeGeneratedRule(aiRule: Partial<ParsingRule>, fallback: ParsingRule): ParsingRule {
  const now = new Date().toISOString();
  return {
    ...fallback,
    ...aiRule,
    id: fallback.id,
    name: aiRule.name || fallback.name,
    sourceKind: aiRule.sourceKind || fallback.sourceKind,
    layout: aiRule.layout || fallback.layout,
    mappings: sanitizeMappings(aiRule.mappings, fallback.mappings),
    createdAt: now,
    updatedAt: now,
    aiGenerated: true,
    assumptions: aiRule.assumptions?.length ? aiRule.assumptions : fallback.assumptions,
    confidence: aiRule.confidence ?? fallback.confidence
  };
}

function hasLabelBleed(value?: string) {
  if (!value) return false;
  return /订货机构|供货机构|送货机构|业务模式|配送重量|收货电话|联系电话|收货地址|制单|打印/.test(value);
}

function resultQuality(rule: ParsingRule, document: IntermediateDocument) {
  try {
    const result = executeRule(document, rule);
    const errorCount = result.issues.filter((issue) => issue.severity === "error").length;
    const fieldCoverage = ORDER_FIELDS.reduce<Record<OrderField, number>>((coverage, field) => {
      coverage[field] = result.rows.filter((row) => {
        const value = row[field];
        if (field === "skuQuantity") return Number(value) > 0;
        return value !== undefined && value !== null && String(value).trim() !== "";
      }).length;
      return coverage;
    }, {} as Record<OrderField, number>);
    const criticalEmptyCount = result.rows.reduce((count, row) => {
      const missingSku = row.skuCode ? 0 : 1;
      const missingName = row.skuName ? 0 : 1;
      const missingQty = row.skuQuantity > 0 ? 0 : 1;
      const missingReceiver = row.storeName || (row.recipientName && row.recipientPhone && row.recipientAddress) ? 0 : 1;
      return count + missingSku + missingName + missingQty + missingReceiver;
    }, 0);
    const labelBleedCount = result.rows.reduce(
      (count, row) => count + [row.storeName, row.recipientName, row.recipientPhone, row.recipientAddress].filter(hasLabelBleed).length,
      0
    );
    return {
      ok: true,
      rows: result.rows.length,
      groups: result.groups.length,
      errorCount,
      warningCount: result.issues.length - errorCount,
      criticalEmptyCount,
      labelBleedCount,
      fieldCoverage,
      quantitySignature: result.rows.map((row) => ({
        destination: row.storeName || [row.recipientName, row.recipientPhone, row.recipientAddress].filter(Boolean).join("|"),
        skuCode: row.skuCode,
        skuName: row.skuName,
        quantity: row.skuQuantity
      }))
    };
  } catch (error) {
    return {
      ok: false,
      rows: 0,
      groups: 0,
      errorCount: 999,
      warningCount: 0,
      criticalEmptyCount: 999,
      labelBleedCount: 999,
      fieldCoverage: ORDER_FIELDS.reduce<Record<OrderField, number>>((coverage, field) => {
        coverage[field] = 0;
        return coverage;
      }, {} as Record<OrderField, number>),
      quantitySignature: [],
      message: error instanceof Error ? error.message : "规则试解析失败"
    };
  }
}

function losesUsefulFieldCoverage(ai: ReturnType<typeof resultQuality>, fallback: ReturnType<typeof resultQuality>) {
  if (fallback.rows === 0 || ai.rows === 0) return false;
  const usefulFields: OrderField[] = ["recipientName", "recipientPhone", "recipientAddress", "externalCode", "skuSpec"];
  return usefulFields.some((field) => {
    const fallbackCount = fallback.fieldCoverage[field] || 0;
    const aiCount = ai.fieldCoverage[field] || 0;
    if (fallbackCount < Math.max(2, Math.ceil(fallback.rows * 0.5))) return false;
    return aiCount < Math.floor(fallbackCount * 0.8);
  });
}

function quantityMismatchCount(ai: ReturnType<typeof resultQuality>, fallback: ReturnType<typeof resultQuality>) {
  if (ai.quantitySignature.length !== fallback.quantitySignature.length) return 0;
  return ai.quantitySignature.reduce((count, row, index) => {
    const reference = fallback.quantitySignature[index];
    const sameLine =
      normalizeCompare(row.destination) === normalizeCompare(reference.destination) &&
      normalizeCompare(row.skuCode) === normalizeCompare(reference.skuCode) &&
      normalizeCompare(row.skuName) === normalizeCompare(reference.skuName);
    if (!sameLine) return count;
    return Number(row.quantity) === Number(reference.quantity) ? count : count + 1;
  }, 0);
}

function qualityFallbackReasons(ai: ReturnType<typeof resultQuality>, fallback: ReturnType<typeof resultQuality>) {
  const reasons: string[] = [];
  if (!ai.ok) reasons.push("AI 规则执行失败");
  if (fallback.rows > 0 && ai.rows === 0) reasons.push("AI 规则未解析出明细行");
  if (fallback.errorCount === 0 && fallback.criticalEmptyCount === 0 && ai.errorCount > 0) reasons.push("参考规则 0 错误但 AI 规则产生错误");
  if (fallback.errorCount === 0 && fallback.criticalEmptyCount === 0 && fallback.rows > 0 && ai.rows < fallback.rows) reasons.push("AI 明细行数少于参考规则");
  if (fallback.rows > 0 && ai.rows < Math.max(1, Math.floor(fallback.rows * 0.9))) reasons.push("AI 明细行数低于参考规则 90%");
  if (fallback.errorCount === 0 && fallback.criticalEmptyCount === 0 && fallback.rows >= 5 && ai.rows >= Math.ceil(fallback.rows * 1.1)) {
    reasons.push("AI 明细行数明显多于参考规则，疑似抽入非明细行");
  }
  if (fallback.errorCount === 0 && fallback.groups > 0 && ai.groups > Math.max(fallback.groups + 3, Math.ceil(fallback.groups * 1.5))) {
    reasons.push("AI 分组数异常膨胀");
  }
  if (ai.errorCount > fallback.errorCount + 3) reasons.push("AI 错误数明显高于参考规则");
  if (ai.criticalEmptyCount > fallback.criticalEmptyCount + Math.max(3, Math.floor(fallback.rows * 0.2))) reasons.push("AI 关键字段缺失明显增加");
  if (ai.labelBleedCount > fallback.labelBleedCount + Math.max(3, Math.floor(fallback.rows * 0.1))) reasons.push("AI 收货字段疑似混入标签文本");
  if (fallback.errorCount === 0 && fallback.criticalEmptyCount === 0 && losesUsefulFieldCoverage(ai, fallback)) reasons.push("AI 有用字段覆盖率下降");
  if (
    fallback.errorCount === 0 &&
    fallback.criticalEmptyCount === 0 &&
    fallback.rows > 0 &&
    ai.rows === fallback.rows &&
    quantityMismatchCount(ai, fallback) > Math.max(1, Math.floor(fallback.rows * 0.2))
  ) {
    reasons.push("AI 数量签名与参考规则不一致");
  }
  return reasons;
}

function qualityLogSummary(ai: ReturnType<typeof resultQuality>, fallback: ReturnType<typeof resultQuality>) {
  return {
    reasons: qualityFallbackReasons(ai, fallback),
    ai: {
      ok: ai.ok,
      rows: ai.rows,
      groups: ai.groups,
      errorCount: ai.errorCount,
      warningCount: ai.warningCount,
      criticalEmptyCount: ai.criticalEmptyCount,
      labelBleedCount: ai.labelBleedCount,
      fieldCoverage: ai.fieldCoverage
    },
    fallback: {
      ok: fallback.ok,
      rows: fallback.rows,
      groups: fallback.groups,
      errorCount: fallback.errorCount,
      warningCount: fallback.warningCount,
      criticalEmptyCount: fallback.criticalEmptyCount,
      labelBleedCount: fallback.labelBleedCount,
      fieldCoverage: fallback.fieldCoverage
    },
    quantityMismatchCount: quantityMismatchCount(ai, fallback),
    losesUsefulFieldCoverage: losesUsefulFieldCoverage(ai, fallback)
  };
}

function isClearlyWorse(ai: ReturnType<typeof resultQuality>, fallback: ReturnType<typeof resultQuality>) {
  return qualityFallbackReasons(ai, fallback).length > 0;
}

export async function generateRuleWithLlm(
  document: IntermediateDocument,
  profile?: RuntimeLlmProfile
): Promise<{ rule: ParsingRule; provider: "llm" | "fallback" }> {
  const fallback = inferRuleFromDocument(document);
  const apiKey = profile?.apiKey?.trim() || (profile?.disableEnvFallback ? "" : process.env.LLM_API_KEY);
  if (!apiKey) return { rule: fallback, provider: "fallback" };

  const baseUrl = profile?.baseUrl?.trim() || (profile?.disableEnvFallback ? "" : process.env.LLM_BASE_URL) || "https://api.deepseek.com";
  const model = profile?.model?.trim() || (profile?.disableEnvFallback ? "" : process.env.LLM_MODEL) || "deepseek-chat";
  const protocol = resolveProtocol(normalizeProtocol(profile?.protocol || (profile?.disableEnvFallback ? "" : process.env.LLM_PROTOCOL)), baseUrl, model);
  const prompt = buildRulePrompt(profile?.prompt);
  const maxTokens = /^minimax-m3$/i.test(model) && isMiniMaxBase(baseUrl) ? 131072 : 4096;
  const fallbackQuality = resultQuality(fallback, document);

  let content = "";
  try {
    const result = await callLlm({
      context: "generate",
      protocol,
      baseUrl,
      model,
      apiKey,
      temperature: profile?.temperature ?? 0.1,
      timeoutMs: Math.max(profile?.timeoutMs ?? 120000, maxTokens > 4096 ? 180000 : 120000),
      prompt,
      userContent: userRulePayload(document, fallback),
      maxTokens
    });
    content = result.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : "大模型调用失败";
    return fallbackResult(fallback, `大模型调用失败：${message}，已使用本地推荐规则。`);
  }

  if (!content) return fallbackResult(fallback, "大模型未返回文本内容，已使用本地推荐规则。");

  let aiRule: Partial<ParsingRule>;
  try {
    aiRule = extractJson(content) as Partial<ParsingRule>;
  } catch (error) {
    const message = error instanceof Error ? error.message : "JSON 解析失败";
    console.warn("[llm:generate:json-repair]", JSON.stringify({ message }, null, 2));
    try {
      const repairResult = await callLlm({
        context: "generate",
        protocol,
        baseUrl,
        model,
        apiKey,
        temperature: 0,
        timeoutMs: Math.max(profile?.timeoutMs ?? 120000, maxTokens > 4096 ? 180000 : 120000),
        prompt: `${prompt}

${RULE_JSON_REPAIR_PROMPT}`,
        userContent: jsonRepairRulePayload({ document, fallback, badContent: content, parseError: message }),
        maxTokens
      });
      const repairedCandidate = extractJson(repairResult.content) as Partial<ParsingRule>;
      const repairedRule = normalizeGeneratedRule(repairedCandidate, fallback);
      const repairedQuality = resultQuality(repairedRule, document);
      if (!isClearlyWorse(repairedQuality, fallbackQuality)) {
        return {
          rule: {
            ...repairedRule,
            assumptions: [
              ...(repairedRule.assumptions || []),
              `AI 初版返回 JSON 不合法，已自动二次修正。JSON 错误：${message}。`,
              `AI 修正规则已通过样例自检：${repairedQuality.rows} 行，${repairedQuality.groups} 单，${repairedQuality.errorCount} 个错误。`
            ]
          },
          provider: "llm"
        };
      }
      console.warn("[llm:generate:json-repair-fallback]", JSON.stringify(qualityLogSummary(repairedQuality, fallbackQuality), null, 2));
    } catch (repairError) {
      const repairMessage = repairError instanceof Error ? repairError.message : "JSON 修正失败";
      console.warn("[llm:generate:json-repair:error]", JSON.stringify({ message: repairMessage }, null, 2));
    }
    return fallbackResult(fallback, `大模型返回内容不是合法规则 JSON：${message}，已使用本地推荐规则。`);
  }

  const generatedRule = normalizeGeneratedRule(aiRule, fallback);
  const aiQuality = resultQuality(generatedRule, document);
  if (isClearlyWorse(aiQuality, fallbackQuality)) {
    const reasons = qualityFallbackReasons(aiQuality, fallbackQuality);
    console.warn("[llm:generate:self-test-repair]", JSON.stringify(qualityLogSummary(aiQuality, fallbackQuality), null, 2));
    try {
      const repairResult = await callLlm({
        context: "generate",
        protocol,
        baseUrl,
        model,
        apiKey,
        temperature: 0,
        timeoutMs: Math.max(profile?.timeoutMs ?? 120000, maxTokens > 4096 ? 180000 : 120000),
        prompt: `${prompt}

${RULE_REPAIR_PROMPT}`,
        userContent: repairRulePayload({
          document,
          fallback,
          rejectedRule: generatedRule,
          rejectedQuality: aiQuality,
          fallbackQuality,
          reasons
        }),
        maxTokens
      });
      const repairedCandidate = extractJson(repairResult.content) as Partial<ParsingRule>;
      const repairedRule = normalizeGeneratedRule(repairedCandidate, fallback);
      const repairedQuality = resultQuality(repairedRule, document);
      if (!isClearlyWorse(repairedQuality, fallbackQuality)) {
        return {
          rule: {
            ...repairedRule,
            assumptions: [
              ...(repairedRule.assumptions || []),
              `AI 初版规则未通过自检，已按质量闸门自动二次修正。初版原因：${reasons.join("、")}。`,
              `AI 修正规则已通过样例自检：${repairedQuality.rows} 行，${repairedQuality.groups} 单，${repairedQuality.errorCount} 个错误。`
            ]
          },
          provider: "llm"
        };
      }
      console.warn("[llm:generate:self-test-fallback]", JSON.stringify(qualityLogSummary(repairedQuality, fallbackQuality), null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : "规则修正失败";
      console.warn("[llm:generate:repair:error]", JSON.stringify({ message }, null, 2));
    }
    return fallbackResult(
      fallback,
      `AI 规则已生成但样例试解析质量低于本地推荐规则，已自动保留本地推荐规则。原因：${reasons.join("、") || "质量闸门未通过"}。AI 质量：${aiQuality.rows} 行/${aiQuality.errorCount} 错误；本地质量：${fallbackQuality.rows} 行/${fallbackQuality.errorCount} 错误。`
    );
  }

  return {
    rule: {
      ...generatedRule,
      assumptions: [
        ...(generatedRule.assumptions || []),
        `AI 规则已通过样例自检：${aiQuality.rows} 行，${aiQuality.groups} 单，${aiQuality.errorCount} 个错误。`
      ]
    },
    provider: "llm"
  };
}
