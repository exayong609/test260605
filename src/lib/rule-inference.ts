import { FIELD_HINTS } from "@/lib/fields";
import { makeId } from "@/lib/ids";
import type { FieldMapping, GridSheet, IntermediateDocument, OrderField, ParsingRule } from "@/types";

function includesAny(value: string, hints: string[]) {
  const normalized = value.replace(/\s/g, "").toLowerCase();
  return hints.some((hint) => normalized.includes(hint.replace(/\s/g, "").toLowerCase()));
}

function cellScore(field: OrderField, cell: string) {
  const normalized = cell.replace(/\s/g, "");
  if (!normalized) return 0;

  const exact: Partial<Record<OrderField, string[]>> = {
    externalCode: ["外部编码", "外部单号", "订单号", "配送单号", "单据号"],
    storeName: ["收货门店", "门店", "收货机构", "收货单位"],
    recipientName: ["收件人姓名", "收件人", "收货人", "联系人"],
    recipientPhone: ["收件人电话", "收货电话", "电话", "手机号", "联系方式"],
    recipientAddress: ["收件人地址", "收货地址", "地址"],
    skuCode: ["SKU物品编码", "SKU编码", "物品编码", "商品编码", "外部商品编码", "SKU条码"],
    skuName: ["SKU物品名称", "SKU名称", "物品名称", "商品名称", "SKU名称", "品名"],
    skuQuantity: ["SKU发货数量", "发货数量", "数量", "订货数量", "应发数量", "实发数量", "下单数量"],
    skuSpec: ["SKU规格型号", "规格型号", "规格"],
    remark: ["备注", "说明"]
  };

  if (exact[field]?.includes(normalized)) return 100;
  if (field === "skuQuantity" && /发货数量|实发数量|应发数量/.test(normalized)) return 90;
  if (field === "skuQuantity" && /库存|在库|可用|冻结|结余|分配|移入|待移入|换算/.test(normalized)) return 0;
  if (field === "storeName" && /^门店[A-Za-z0-9一二三四五六七八九十甲乙丙丁]*$/.test(normalized) && normalized !== "门店") return 0;
  if (field === "skuSpec" && /单位|换算/.test(normalized)) return 0;
  if (field === "skuCode" && /单据|订单|配送单/.test(normalized)) return 0;
  if (field === "externalCode" && /物品|商品|SKU|条码/.test(normalized)) return 0;
  if (includesAny(normalized, FIELD_HINTS[field])) return 30;
  return 0;
}

function findHeader(sheet: GridSheet) {
  let best = { rowIndex: 0, score: 0, indexes: {} as Partial<Record<OrderField, number>> };
  sheet.rows.slice(0, 20).forEach((row, rowIndex) => {
    const indexes: Partial<Record<OrderField, number>> = {};
    const fieldScores: Partial<Record<OrderField, number>> = {};
    let score = 0;
    row.forEach((cell, columnIndex) => {
      (Object.keys(FIELD_HINTS) as OrderField[]).forEach((field) => {
        const currentScore = cellScore(field, cell);
        if (currentScore > (fieldScores[field] || 0)) {
          indexes[field] = columnIndex;
          fieldScores[field] = currentScore;
        }
      });
    });
    score = Object.entries(fieldScores).reduce((sum, [field, value]) => {
      const weighted = field === "skuCode" || field === "skuName" || field === "skuQuantity" ? value * 2 : value;
      return sum + weighted;
    }, 0);
    if (score > best.score) best = { rowIndex, score, indexes };
  });
  return best;
}

function makeColumnMappings(indexes: Partial<Record<OrderField, number>>) {
  return (Object.entries(indexes) as Array<[OrderField, number]>).map<FieldMapping>(([field, columnIndex]) => ({
    kind: "column",
    field,
    columnIndex
  }));
}

function inferKeyValueCellMappings(sheet: GridSheet) {
  const labelMatchers: Array<[OrderField, RegExp]> = [
    ["externalCode", /^(外部编码|外部单号|订单号|配送单号|单据号)$/],
    ["storeName", /^(收货门店|门店|收货机构|收货单位)$/],
    ["recipientName", /^(收件人姓名|收件人|收货人|联系人)$/],
    ["recipientPhone", /^(收件人电话|收货电话|电话|手机号|联系方式)$/],
    ["recipientAddress", /^(收件人地址|收货地址|地址)$/],
    ["remark", /^(备注|说明)$/]
  ];
  const mappings: FieldMapping[] = [];
  const used = new Set<OrderField>();

  sheet.rows.forEach((row, rowIndex) => {
    row.forEach((cell, columnIndex) => {
      const normalized = cell.replace(/\s/g, "").replace(/[：:]+$/, "");
      const match = labelMatchers.find(([field, pattern]) => !used.has(field) && pattern.test(normalized));
      if (!match) return;
      const valueColumnIndex = row.findIndex((candidate, candidateIndex) => candidateIndex > columnIndex && Boolean(candidate.trim()));
      if (valueColumnIndex > columnIndex) {
        mappings.push({ kind: "cell", field: match[0], rowIndex, columnIndex: valueColumnIndex });
        used.add(match[0]);
      }
    });
  });

  return mappings;
}

function inferTailRegexMappings(text: string) {
  const mappings: FieldMapping[] = [];
  if (/收货人|收件人|联系人/.test(text)) {
    mappings.push({ kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)[:：\\s]*([^\\n\\s|]+)", group: 1, scope: "tail" });
  }
  if (/电话|手机|联系方式/.test(text)) {
    mappings.push({ kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|电话|手机|联系方式)[:：\\s]*([0-9\\-\\s]{7,20})", group: 1, scope: "tail" });
  }
  if (/地址/.test(text)) {
    mappings.push({ kind: "regex", field: "recipientAddress", pattern: "(?:地址|收货地址)[:：\\s]*([^\\n]+)", group: 1, scope: "tail" });
  }
  return mappings;
}

function inferMatrix(sheet: GridSheet, header: ReturnType<typeof findHeader>) {
  const row = sheet.rows[header.rowIndex] || [];
  const fixedColumns = header.indexes;
  const hasExplicitQuantity = row.some((cell) => /发货数量|实发数量|应发数量/.test(cell.replace(/\s/g, "")));
  if (hasExplicitQuantity) return undefined;

  const fixedIndexes = [fixedColumns.skuCode, fixedColumns.skuName, fixedColumns.skuSpec].filter((value) => value !== undefined) as number[];
  const lastFixed = Math.max(...fixedIndexes, -1);
  const candidateColumns = row
    .map((cell, index) => ({ cell: cell.trim(), index }))
    .filter(({ cell, index }) => {
      if (!cell || index <= lastFixed) return false;
      if (/库存|在库|数量|结余|分配|冻结|移入|待移入|换算|单位|状态|仓库|货主/.test(cell)) return false;
      const sample = sheet.rows.slice(header.rowIndex + 1, header.rowIndex + 16).map((sampleRow) => sampleRow[index]).filter(Boolean);
      const numericCount = sample.filter((value) => /^\d+(?:\.\d+)?$/.test(String(value).trim())).length;
      return sample.length > 0 && numericCount / sample.length >= 0.5;
    });

  const matrixStartColumnIndex = candidateColumns[0]?.index ?? -1;
  if (matrixStartColumnIndex >= 0 && candidateColumns.length >= 2 && (fixedColumns.skuName !== undefined || fixedColumns.skuCode !== undefined)) {
    const matrixEndColumnIndex = candidateColumns[candidateColumns.length - 1].index + 1;
    return {
      headerRowIndex: header.rowIndex,
      dataStartRowIndex: header.rowIndex + 1,
      fixedColumns: {
        skuCode: fixedColumns.skuCode,
        skuName: fixedColumns.skuName,
        skuSpec: fixedColumns.skuSpec,
        remark: fixedColumns.remark
      },
      matrixStartColumnIndex,
      matrixEndColumnIndex,
      compoundSeparatorPattern: "\\n|；|;"
    };
  }
  return undefined;
}

export function inferRuleFromDocument(document: IntermediateDocument): ParsingRule {
  const now = new Date().toISOString();
  const firstSheet = document.sheets[0];

  if (document.sourceKind === "excel" && firstSheet) {
    if (/调拨记录|调拨单号|调入门店/.test(document.text)) {
      return {
        id: makeId("rule"),
        name: `${document.fileName} 推荐卡片规则`,
        description: "本地分析识别为卡片式调拨结构，按调拨记录分段后提取每段收货信息和物品行。",
        sourceKind: "excel",
        layout: "cards",
        createdAt: now,
        updatedAt: now,
        aiGenerated: false,
        confidence: 0.74,
        assumptions: ["每个“调拨记录”视为一个收货区块。", "区块内物品行需要包含物品编码、名称、规格和数量。"],
        sectionStartPattern: "调拨记录",
        itemLinePattern: "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
        mappings: [
          { kind: "regex", field: "externalCode", pattern: "(?:调拨单号|单号)[:：\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "document" },
          { kind: "regex", field: "storeName", pattern: "调入门店\\s*(?:\\|\\s*)?\\[?\\d*\\]?\\s*([^|\\n]+)", group: 1, scope: "section" },
          { kind: "regex", field: "recipientName", pattern: "收货人\\s*(?:\\|\\s*)?\\[?\\d*\\]?\\s*([^|\\n]+)", group: 1, scope: "section" },
          { kind: "regex", field: "recipientPhone", pattern: "电话\\s*(?:\\|\\s*)?([0-9\\-\\s]{7,20})", group: 1, scope: "section" },
          { kind: "regex", field: "recipientAddress", pattern: "收货地址\\s*(?:\\|\\s*)?\\[?\\d*\\]?\\s*([^|\\n]+)", group: 1, scope: "section" }
        ]
      };
    }

    const header = findHeader(firstSheet);
    const matrix = inferMatrix(firstSheet, header);
    const tailMappings = inferTailRegexMappings(document.text);
    const cellMappings = inferKeyValueCellMappings(firstSheet);
    const mappedFields = new Set<OrderField>();
    const mappings = [...makeColumnMappings(header.indexes), ...cellMappings, ...tailMappings].filter((mapping) => {
      if (mappedFields.has(mapping.field) && mapping.kind !== "regex") return false;
      if (mapping.kind !== "regex") mappedFields.add(mapping.field);
      return true;
    });

    const missingSku = !mappings.some((mapping) => mapping.field === "skuCode");
    const missingName = !mappings.some((mapping) => mapping.field === "skuName");
    const missingQty = !mappings.some((mapping) => mapping.field === "skuQuantity");

    if (matrix) {
      return {
        id: makeId("rule"),
        name: `${document.fileName} 推荐矩阵规则`,
        description: "本地分析识别为横向矩阵结构，门店/日期列将转置为独立下单行。",
        sourceKind: "excel",
        layout: "matrix",
        createdAt: now,
        updatedAt: now,
        aiGenerated: false,
        confidence: 0.72,
        assumptions: ["矩阵列头被视为收货门店或配送维度，请确认。", "空数量单元格会被跳过。"],
        sheetMode: document.stats.sheetCount > 1 ? "all" : "first",
        matrix,
        mappings: [
          ...makeColumnMappings(matrix.fixedColumns),
          { kind: "matrixColumn", field: "storeName" },
          { kind: "compoundPart", field: "skuName", part: "name" },
          { kind: "compoundPart", field: "skuQuantity", part: "quantity" }
        ]
      };
    }

    return {
      id: makeId("rule"),
      name: `${document.fileName} 推荐表格规则`,
      description: "本地分析识别为标准表格/多 Sheet 表格结构，可继续微调表头行、数据起始行和字段映射。",
      sourceKind: "excel",
      layout: "tabular",
      createdAt: now,
      updatedAt: now,
      aiGenerated: false,
      confidence: header.score >= 6 ? 0.8 : 0.55,
      assumptions: [
        `表头行推测为第 ${header.rowIndex + 1} 行。`,
        missingSku ? "未可靠识别 SKU 编码列，请手动确认。" : "SKU 编码列已推测。",
        missingName ? "未可靠识别 SKU 名称列，请手动确认。" : "SKU 名称列已推测。",
        missingQty ? "未可靠识别 SKU 数量列，请手动确认。" : "SKU 数量列已推测。"
      ],
      sheetMode: document.stats.sheetCount > 1 ? "all" : "first",
      headerRowIndex: header.rowIndex,
      dataStartRowIndex: header.rowIndex + 1,
      stopWhenRowMatches: "合计|总计|小计",
      skipRowPatterns: ["合计", "总计", "^\\s*$"],
      groupBy: header.indexes.externalCode !== undefined ? "externalCode" : undefined,
      mappings
    };
  }

  const separator = /━{3,}|-{5,}|={5,}|调拨记录|配送签收单/.test(document.text)
    ? "━{3,}|-{5,}|={5,}|(?=调拨记录)|(?=配送签收单)"
    : "\\n\\s*\\n";

  return {
    id: makeId("rule"),
    name: `${document.fileName} 推荐文本规则`,
    description: "本地分析识别为文本/PDF 分段结构，按分隔符拆分订单区块后提取字段和物品行。",
    sourceKind: document.sourceKind,
    layout: "textBlocks",
    createdAt: now,
    updatedAt: now,
    aiGenerated: false,
    confidence: 0.58,
    assumptions: ["文本分隔符和物品行格式需要人工确认。", "PDF 表格会优先按文本行提取，复杂表格需微调正则。"],
    sectionSeparatorPattern: separator,
    itemLinePattern: "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
    mappings: [
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|配送单号|订单号|单据编号|单号)[:：\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "section" },
      { kind: "regex", field: "storeName", pattern: "(?:门店|收货门店|收货单位|收货机构)[:：\\s]*([^\\n]+?)(?=订货机构|供货机构|送货机构|业务模式|配送重量|\\n|$)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)[:：\\s]*([^\\n\\s：:]+?)(?=收货电话|电话|手机|联系方式|\\n|$)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:电话|手机|联系方式)[:：\\s]*([0-9\\-\\s]{7,20})", group: 1, scope: "section" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:地址|收货地址)[:：\\s]*([^\\n]+)", group: 1, scope: "section" }
    ]
  };
}
