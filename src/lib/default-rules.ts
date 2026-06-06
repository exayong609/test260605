import type { ParsingRule } from "@/types";

const now = "2026-06-01T00:00:00.000Z";

export const DEFAULT_RULES: ParsingRule[] = [
  {
    id: "template_tabular_standard",
    name: "内置｜标准配送单：表头明细 + 尾部收货",
    description: "适合上方是单据信息、中间是 SKU 明细表、下方散落收货人和地址的配送发货单。",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: now,
    updatedAt: now,
    confidence: 0.78,
    assumptions: ["表头在前 20 行内。", "SKU 明细到合计行结束。", "单据号和收货信息从整张表的标签区域提取。"],
    sheetMode: "first",
    autoDetectHeader: true,
    headerSearchRows: 20,
    stopWhenRowMatches: "合计|总计|小计",
    skipRowPatterns: ["合计", "总计", "小计", "^\\s*$"],
    groupBy: "externalCode",
    mappings: [
      { kind: "column", field: "skuCode", header: "物品编码" },
      { kind: "column", field: "skuName", header: "物品名称" },
      { kind: "column", field: "skuQuantity", header: "发货数量" },
      { kind: "column", field: "skuSpec", header: "规格型号" },
      { kind: "column", field: "remark", header: "备注" },
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|配送单号|订单号|单据号|单号)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([A-Za-z][A-Za-z0-9_-]{3,}|[0-9]{6,})", group: 1, scope: "document" },
      { kind: "regex", field: "storeName", pattern: "(?:收货机构|收货门店|收货单位|门店)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n]+)", group: 1, scope: "document" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n\\s]+)", group: 1, scope: "tail" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|联系电话|电话|手机|联系方式)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([0-9\\-\\s]{7,20})", group: 1, scope: "tail" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:收货地址|地址)\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*|[:：\\s]+)([^|\\n]+)", group: 1, scope: "tail" }
    ]
  },
  {
    id: "template_tabular_summary",
    name: "内置｜汇总明细表：逐行收货字段",
    description: "适合每条 SKU 明细行都带门店、配送单号、收货人、电话、地址的汇总发货明细。",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: now,
    updatedAt: now,
    confidence: 0.82,
    assumptions: ["表头在前 10 行内。", "配送单号作为外部编码。", "每一行已经包含完整收货信息。"],
    sheetMode: "first",
    autoDetectHeader: true,
    headerSearchRows: 10,
    skipRowPatterns: ["^\\s*$", "必填项", "合计", "总计", "小计"],
    groupBy: "externalCode",
    mappings: [
      { kind: "column", field: "storeName", header: "收货机构" },
      { kind: "column", field: "externalCode", header: "配送单号" },
      { kind: "column", field: "skuCode", header: "物品编码" },
      { kind: "column", field: "skuName", header: "物品名称" },
      { kind: "column", field: "skuSpec", header: "规格型号" },
      { kind: "column", field: "skuQuantity", header: "发货数量" },
      { kind: "column", field: "recipientName", header: "收货人" },
      { kind: "column", field: "recipientPhone", header: "收货电话" },
      { kind: "column", field: "recipientAddress", header: "收货地址" },
      { kind: "column", field: "remark", header: "物品备注" }
    ]
  },
  {
    id: "template_multisheet_tabular",
    name: "内置｜多 Sheet 出库单：Sheet 合并 + 尾部收货",
    description: "适合每个 Sheet 代表一个门店、表内有 SKU 明细、尾部有联系人和地址的出库单。",
    sourceKind: "excel",
    layout: "tabular",
    createdAt: now,
    updatedAt: now,
    confidence: 0.76,
    assumptions: ["会遍历所有 Sheet。", "每个 Sheet 的尾部收货信息只作用于当前 Sheet。", "没有尾部门店时使用 Sheet 名作为门店。"],
    sheetMode: "all",
    autoDetectHeader: true,
    headerSearchRows: 20,
    stopWhenRowMatches: "合计|总计|小计",
    skipRowPatterns: ["合计", "总计", "小计", "^\\s*$", "制单人", "审核人", "签字"],
    mappings: [
      { kind: "column", field: "skuCode", header: "物品编码" },
      { kind: "column", field: "skuName", header: "物品名称" },
      { kind: "column", field: "skuQuantity", header: "出库数量" },
      { kind: "column", field: "skuSpec", header: "规格型号" },
      { kind: "column", field: "remark", header: "备注" },
      { kind: "regex", field: "storeName", pattern: "收货门店[:：]?\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*)?([^|\\n]+)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientName", pattern: "(?:联系人|收货人|收件人)[:：]?\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*)?([^|\\n]+)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:联系电话|收货电话|电话|手机|联系方式)[:：]?\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*)?([0-9\\-\\s]{7,20})", group: 1, scope: "section" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:收货地址|地址)[:：]?\\s*(?:\\|\\s*\\[?\\d+\\]?\\s*)?([^|\\n]+)", group: 1, scope: "section" },
      { kind: "sheetName", field: "storeName" }
    ]
  },
  {
    id: "template_matrix_store_columns",
    name: "内置｜门店矩阵：SKU 行 x 门店列",
    description: "适合 SKU 纵向、门店横向展开的库存/下单矩阵；只把门店数量列转成明细。",
    sourceKind: "excel",
    layout: "matrix",
    createdAt: now,
    updatedAt: now,
    confidence: 0.8,
    assumptions: ["矩阵列头作为收货门店。", "库存、可用、冻结、结余等非门店列不参与导入。", "空数量单元格会跳过。"],
    sheetMode: "first",
    matrix: {
      headerRowIndex: 0,
      dataStartRowIndex: 1,
      fixedColumns: {
        skuName: 2,
        skuCode: 3,
        skuSpec: 7
      },
      matrixStartColumnIndex: 13,
      matrixEndColumnIndex: 18,
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
    name: "内置｜PDF 编号文本：跨行规格明细",
    description: "适合 PDF/Word 中按序号连续列出物品，且规格可能跨行换页的文本结构。",
    sourceKind: "any",
    layout: "textBlocks",
    createdAt: now,
    updatedAt: now,
    confidence: 0.74,
    assumptions: ["物品行以序号开头并包含 SKU 编码。", "收货信息通过文档标签提取。", "跨行规格会在编号行解析器中合并。"],
    sectionSeparatorPattern: "━{3,}|-{5,}|={5,}|\\n\\s*\\n",
    itemLinePattern: "^(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*(\\d+(?:\\.\\d+)?)\\s*$",
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
    name: "内置｜卡片式调拨：区块拆分 + 小表明细",
    description: "适合多个调拨记录纵向堆叠，每个区块有独立门店、收货信息和物品小表的文件。",
    sourceKind: "any",
    layout: "cards",
    createdAt: now,
    updatedAt: now,
    confidence: 0.76,
    assumptions: ["每个调拨记录是一个独立订单区块。", "区块内门店、收货人、电话、地址使用区块级正则。", "调拨单号作为整份文件共享外部编码。"],
    sectionStartPattern: "调拨记录|配送记录|订单记录",
    sectionSeparatorPattern: "▶\\s*调拨记录\\s*#?\\d+|调拨记录\\s*#?\\d+|━{3,}|-{5,}|={5,}",
    itemLinePattern: "^([A-Za-z0-9_-]{2,})\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*(\\d+(?:\\.\\d+)?)\\s*$",
    mappings: [
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|调拨单号|配送单号|订单号|单号)[:：\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "section" },
      { kind: "regex", field: "externalCode", pattern: "(?:外部编码|调拨单号|配送单号|订单号|单号)[:：\\s]*([A-Za-z0-9_-]+)", group: 1, scope: "document" },
      { kind: "regex", field: "storeName", pattern: "(?:调入门店|收货门店|目标门店|门店|收货单位)\\s*(?:\\|\\s*)?([^|\\n]+)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientName", pattern: "(?:收货人|收件人|联系人)\\s*(?:\\|\\s*)?([^|\\n]+?)(?=\\s*\\|\\s*(?:收货电话|电话|手机|联系方式)|\\n|$)", group: 1, scope: "section" },
      { kind: "regex", field: "recipientPhone", pattern: "(?:收货电话|电话|手机|联系方式)\\s*(?:\\|\\s*)?([0-9\\-\\s]{7,20})", group: 1, scope: "section" },
      { kind: "regex", field: "recipientAddress", pattern: "(?:地址|收货地址)\\s*(?:\\|\\s*)?([^|\\n]+)", group: 1, scope: "section" }
    ]
  },
  {
    id: "template_weekly_plan_matrix",
    name: "内置｜周计划矩阵：门店行 x 日期列",
    description: "适合门店纵向、日期横向、单元格中包含多行物品名 x 数量的周配送计划。",
    sourceKind: "excel",
    layout: "matrix",
    createdAt: now,
    updatedAt: now,
    confidence: 0.62,
    assumptions: ["第 1 列作为收货门店。", "日期列头写入备注。", "没有 SKU 编码时使用 AUTO-SKU 占位，提交前可人工补齐。"],
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
