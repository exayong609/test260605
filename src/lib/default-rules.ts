import type { ParsingRule } from "@/types";

const now = "2026-06-01T00:00:00.000Z";

export const DEFAULT_RULES: ParsingRule[] = [
  {
    id: "template_tabular_standard",
    name: "通用标准表格规则",
    description: "适合首行或前几行为表头、后续行为 SKU 明细的 Excel。可调整表头行、数据起始行和字段列号。",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: now,
    updatedAt: now,
    confidence: 0.7,
    assumptions: ["会在前 20 行扫描表头，请根据样例文件确认列号。", "合计/总计/小计行会被跳过。", "收货信息可从数据列或文档尾部标签提取。"],
    sheetMode: "first",
    autoDetectHeader: true,
    headerSearchRows: 20,
    stopWhenRowMatches: "合计|总计|小计",
    skipRowPatterns: ["合计", "总计", "小计", "^\\s*$"],
    groupBy: "externalCode",
    mappings: [
      { kind: "column", field: "externalCode", header: "外部编码" },
      { kind: "column", field: "storeName", header: "收货门店" },
      { kind: "column", field: "recipientName", header: "收件人" },
      { kind: "column", field: "recipientPhone", header: "电话" },
      { kind: "column", field: "recipientAddress", header: "地址" },
      { kind: "column", field: "skuCode", header: "编码" },
      { kind: "column", field: "skuName", header: "名称" },
      { kind: "column", field: "skuQuantity", header: "数量" },
      { kind: "column", field: "skuSpec", header: "规格" },
      { kind: "column", field: "remark", header: "备注" },
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|配送单号|订单号|单据号|单号)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([A-Za-z][A-Za-z0-9_-]{3,}|[0-9]{6,})", group: 1, scope: "document" },
      { kind: "regex", field: "storeName", pattern: "(?:收货机构|收货门店|收货单位|门店)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n]+)", group: 1, scope: "document" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n\\s]+)", group: 1, scope: "tail" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|电话|手机|联系方式)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([0-9\\-\\s]{7,20})", group: 1, scope: "tail" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:收货地址|地址)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n]+)", group: 1, scope: "tail" }
    ]
  },
  {
    id: "template_multisheet_tabular",
    name: "通用多 Sheet 表格规则",
    description: "适合每个 Sheet 结构一致、需要合并导入的 Excel。Sheet 名可作为门店字段。",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: now,
    updatedAt: now,
    confidence: 0.68,
    assumptions: ["会遍历所有 Sheet。", "会在每个 Sheet 前 20 行扫描表头。", "如果 Sheet 名不是门店，请删除 sheetName 映射。"],
    sheetMode: "all",
    autoDetectHeader: true,
    headerSearchRows: 20,
    stopWhenRowMatches: "合计|总计|小计",
    skipRowPatterns: ["合计", "总计", "小计", "^\\s*$"],
    mappings: [
      { kind: "sheetName", field: "storeName" },
      { kind: "column", field: "externalCode", header: "外部编码" },
      { kind: "column", field: "recipientName", header: "收件人" },
      { kind: "column", field: "recipientPhone", header: "电话" },
      { kind: "column", field: "recipientAddress", header: "地址" },
      { kind: "column", field: "skuCode", header: "编码" },
      { kind: "column", field: "skuName", header: "名称" },
      { kind: "column", field: "skuQuantity", header: "数量" },
      { kind: "column", field: "skuSpec", header: "规格" },
      { kind: "column", field: "remark", header: "备注" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n\\s]+)", group: 1, scope: "tail" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|电话|手机|联系方式)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([0-9\\-\\s]{7,20})", group: 1, scope: "tail" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:收货地址|地址)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n]+)", group: 1, scope: "tail" }
    ]
  },
  {
    id: "template_matrix_store_columns",
    name: "通用门店矩阵转置规则",
    description: "适合 SKU 纵向、门店/日期横向展开的 Excel。非空数量单元格会展开为独立下单行。",
    sourceKind: "excel",
    layout: "matrix",
    createdAt: now,
    updatedAt: now,
    confidence: 0.66,
    assumptions: ["矩阵列头会作为收货门店。", "数量单元格只填写数字时，SKU 名称来自固定列。"],
    sheetMode: "first",
    matrix: {
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      fixedColumns: {
        skuName: 2,
        skuCode: 3,
        skuSpec: 7
      },
      matrixStartColumnIndex: 8,
      compoundSeparatorPattern: "\\n|；|;"
    },
    mappings: [
      { kind: "column", field: "skuName", columnIndex: 2 },
      { kind: "column", field: "skuCode", columnIndex: 3 },
      { kind: "column", field: "skuSpec", columnIndex: 7 },
      { kind: "matrixColumn", field: "storeName" },
      { kind: "compoundPart", field: "skuName", part: "name" },
      { kind: "compoundPart", field: "skuQuantity", part: "quantity" }
    ]
  },
  {
    id: "template_pdf_text_numbered",
    name: "通用 PDF/Word 编号文本规则",
    description: "适合 PDF 或 Word 中按序号列出物品行、底部或头部有收货信息的文本结构。",
    sourceKind: "any",
    layout: "textBlocks",
    createdAt: now,
    updatedAt: now,
    confidence: 0.62,
    assumptions: ["物品行需要有序号和 SKU 编码。", "收货信息通过标签正则提取，请确认标签名称。"],
    sectionSeparatorPattern: "━{3,}|-{5,}|={5,}|\\n\\s*\\n",
    itemLinePattern: "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
    mappings: [
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|配送单号|订单号|单据编号|单号)[:：\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "document" },
      { kind: "regex", field: "storeName", pattern: "(?:门店|收货门店|收货单位|收货机构)[:：\\s]*([^\\n]+?)(?=订货机构|供货机构|送货机构|业务模式|配送重量|\\n|$)", group: 1, scope: "document" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)[:：\\s]*([^\\n\\s：:]+?)(?=收货电话|电话|手机|联系方式|\\n|$)", group: 1, scope: "document" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|电话|手机|联系方式)[:：\\s]*([0-9\\-\\s]{7,20})", group: 1, scope: "document" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:地址|收货地址)[:：\\s]*([^\\n]+)", group: 1, scope: "document" }
    ]
  },
  {
    id: "template_card_transfer",
    name: "通用卡片式调拨规则",
    description: "适合每条记录由标题、收货信息和物品小表组成，并纵向堆叠的卡片式文件。",
    sourceKind: "any",
    layout: "cards",
    createdAt: now,
    updatedAt: now,
    confidence: 0.6,
    assumptions: ["使用卡片标题或分隔线切分记录。", "卡片内物品行可用管道、空格或编号格式提取。"],
    sectionStartPattern: "调拨记录|配送记录|订单记录",
    sectionSeparatorPattern: "▶\\s*调拨记录\\s*#?\\d+|调拨记录\\s*#?\\d+|━{3,}|-{5,}|={5,}",
    itemLinePattern: "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
    mappings: [
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|调拨单号|配送单号|订单号|单号)[:：\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "section" },
      { kind: "regex", field: "storeName", pattern: "(?:收货门店|目标门店|门店|收货单位)[:：\\s]*([^\\n]+)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)[:：\\s]*([^\\n\\s：:]+?)(?=收货电话|电话|手机|联系方式|\\n|$)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|电话|手机|联系方式)[:：\\s]*([0-9\\-\\s]{7,20})", group: 1, scope: "section" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:地址|收货地址)[:：\\s]*([^\\n]+)", group: 1, scope: "section" }
    ]
  },
  {
    id: "template_weekly_plan_matrix",
    name: "通用周计划双重转置规则",
    description: "适合门店纵向、日期横向、单元格中包含多行“物品名x数量”的周配送计划。",
    sourceKind: "excel",
    layout: "matrix",
    createdAt: now,
    updatedAt: now,
    confidence: 0.6,
    assumptions: ["第 1 列作为收货门店。", "日期列头会写入备注。", "没有 SKU 编码时使用 AUTO-SKU 占位，提交前可人工补齐。"],
    sheetMode: "first",
    skipRowPatterns: ["合计", "总计", "小计", "^\\s*$"],
    matrix: {
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      fixedColumns: {
        storeName: 0
      },
      matrixStartColumnIndex: 1,
      compoundSeparatorPattern: "\\n|；|;|、"
    },
    mappings: [
      { kind: "column", field: "storeName", columnIndex: 0 },
      { kind: "matrixColumn", field: "remark" },
      { kind: "constant", field: "skuCode", value: "AUTO-SKU" },
      { kind: "compoundPart", field: "skuName", part: "name" },
      { kind: "compoundPart", field: "skuQuantity", part: "quantity" }
    ]
  }
];
