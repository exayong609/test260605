# 使用与场景配置指南

本文档用于最终验收和演示，覆盖本地运行、Vercel 部署、大模型 Profile 配置、AI 生成规则流程，以及 9 类题面场景的规则配置方法。

## 1. 本地运行

```bash
npm install
npm run dev
```

默认访问：

```bash
http://127.0.0.1:3000
```

健康检查：

```bash
http://127.0.0.1:3000/api/health
```

返回中建议确认：

- `ok: true`
- `storage: database`
- `llmConfigured: true`
- `defaultRuleCount >= 6`

## 2. Vercel 部署

部署前先确认本地通过：

```bash
npm run typecheck
npm run lint
npm run smoke
npm run build
```

Vercel 操作：

1. 推送 GitHub 仓库。
2. Vercel 导入该仓库。
3. Node 版本使用 `22.x`，项目已在 `package.json` 配置。
4. 配置环境变量。
5. 部署完成后访问首页和 `/api/health`。
6. 在页面里检查“模型配置”和“规则配置”。

必填环境变量：

```bash
DATABASE_URL=
NEXT_PUBLIC_DATABASE_LABEL=Vercel Marketplace DB
```

说明：

- `DATABASE_URL` 推荐使用 Neon pooled 连接串。
- 项目首次访问接口时会自动创建表：`parsing_rules`、`imported_orders`、`llm_profiles`。
- 如果不配置数据库，本地会回退到 `data/local-store.json`；正式部署不建议回退本地文件。

可选环境变量兜底模型：

```bash
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_PROTOCOL=openai-compatible
```

更推荐在页面“模型配置”中维护数据库 Profile。

## 3. 大模型 Profile 配置

入口：主页点击“模型配置”。

Profile 字段：

| 字段 | 说明 |
| --- | --- |
| 名称 | 例如 MiniMax-M3 |
| 接口协议 | `openai-compatible`、`anthropic-compatible`、`minimax-native` |
| API URL | 大模型接口地址 |
| API Key | 只保存到服务端数据库，前端列表只显示 Key 是否已保存 |
| 模型名称 | 例如 `MiniMax-M3` |
| 温度 | 建议 `0` 到 `0.1` |
| 超时 | 复杂文件建议 `90000` 到 `180000` ms |

MiniMax-M3 推荐配置：

```bash
protocol=minimax-native
baseUrl=https://api.minimaxi.com/v1/text/chatcompletion_v2
model=MiniMax-M3
temperature=0.1
timeoutMs=90000
```

配置后点击“测试连接”。成功后页面会显示连接可用；服务端日志会打印脱敏响应摘要，不打印 API Key。

## 4. 标准导入流程

使用已有规则：

1. 上传 Excel、Word 或 PDF。
2. 在“规则模板”下拉框选择已有规则。
3. 点击“解析全部文件”。
4. 在主表格检查明细和全量校验结果。
5. 必要时直接编辑单元格、新增行或删除行。
6. 校验无错误后点击“提交下单”。
7. 提交成功后自动打开“已导入”列表。

AI 新建规则：

1. 上传文件。
2. 点击“规则配置”。
3. 选择模型 Profile。
4. 展开“提示词配置”，必要时补充场景要求。
5. 点击“AI 生成规则”。
6. 查看规则 JSON 和 assumptions。
7. 点击“预解析”，确认样例结果。
8. 微调 JSON 后点击“保存”。
9. 回主页点击“解析全部文件”。

注意：上传时不会自动匹配规则，必须由用户手动选择已有规则或在规则配置里新建/AI 生成。

## 5. 规则 JSON 关键字段

常用字段：

```json
{
  "sourceKind": "excel",
  "layout": "tabular",
  "sheetMode": "first",
  "headerRowIndex": 0,
  "dataStartRowIndex": 1,
  "stopWhenRowMatches": "合计|总计|小计",
  "groupBy": "externalCode",
  "mappings": []
}
```

常用 layout：

| layout | 用途 |
| --- | --- |
| `tabular` | 标准表格、干扰头部、尾部固定信息、多 Sheet 同构表格 |
| `matrix` | 门店或日期横向展开，需要转置 |
| `cards` | 多个卡片区块，每个区块有独立收货信息和物品小表 |
| `textBlocks` | Word/PDF 纯文本，按段落或分隔线提取 |
| `multiSection` | 一个文本/PDF 内有多个独立订单 |

常用 mapping：

| kind | 用途 |
| --- | --- |
| `column` | 从表格列取值 |
| `cell` | 从固定单元格取值 |
| `regex` | 从文本、尾部或区块中正则提取 |
| `constant` | 固定值 |
| `sheetName` | Sheet 名作为字段 |
| `matrixColumn` | 矩阵列头作为字段 |
| `compoundPart` | 复合单元格拆出名称或数量 |

## 6. 9 类场景配置方法

### 6.1 黎明屯配送发货单

本地 demo：

```text
demos/12.25海口龙湖天街-配送发货单PS2512220005001(1).xlsx
```

推荐方式：

- 使用“规则配置 -> AI 生成规则”。
- 或选择“通用标准表格规则”后直接解析。

配置要点：

- `layout: tabular`
- 前几行是干扰头部，需要定位真实表头。
- 数据区遇到“合计”停止。
- 收货人、电话、地址在尾部，需要 `cell` 或 `regex scope=tail`。
- `groupBy: externalCode`，同一单号下多 SKU 保留多行。

示例片段：

```json
{
  "layout": "tabular",
  "sheetMode": "first",
  "headerRowIndex": 3,
  "dataStartRowIndex": 4,
  "stopWhenRowMatches": "合计|总计|小计",
  "groupBy": "externalCode",
  "mappings": [
    { "kind": "column", "field": "skuCode", "columnIndex": 2 },
    { "kind": "column", "field": "skuName", "columnIndex": 3 },
    { "kind": "column", "field": "skuSpec", "columnIndex": 5 },
    { "kind": "column", "field": "skuQuantity", "columnIndex": 12 },
    { "kind": "regex", "field": "recipientPhone", "pattern": "(?:电话|手机|联系方式)[:：\\s]*([0-9\\-\\s]{7,20})", "group": 1, "scope": "tail" }
  ]
}
```

当前验证：2 行，1 单，0 问题。

### 6.2 湖南仓发货明细

本地 demo：

```text
demos/湖南仓.xlsx
```

推荐方式：

- AI 生成规则。
- 或使用标准表格思路手动配置。

配置要点：

- `layout: tabular`
- 第 1 行说明文字，第 2 行表头，第 3 行起是明细。
- 每行都带收货机构、收货人、电话、地址。
- 外部编码取配送单号，按外部编码聚合。

示例片段：

```json
{
  "layout": "tabular",
  "headerRowIndex": 1,
  "dataStartRowIndex": 2,
  "groupBy": "externalCode",
  "mappings": [
    { "kind": "column", "field": "storeName", "columnIndex": 0 },
    { "kind": "column", "field": "externalCode", "columnIndex": 2 },
    { "kind": "column", "field": "skuCode", "columnIndex": 5 },
    { "kind": "column", "field": "skuName", "columnIndex": 6 },
    { "kind": "column", "field": "skuSpec", "columnIndex": 8 },
    { "kind": "column", "field": "skuQuantity", "columnIndex": 11 }
  ]
}
```

当前验证：167 行，61 单，0 问题。

### 6.3 欢乐牧场模板

本地 demo：

```text
demos/欢乐牧场模板0430.xlsx
```

推荐方式：

- AI 生成规则。
- 或选择“通用门店矩阵转置规则”后微调矩阵列范围。

配置要点：

- `layout: matrix`
- SKU 信息在固定列。
- 门店名在横向列头。
- 交叉单元格是发货数量，空值跳过。

示例片段：

```json
{
  "layout": "matrix",
  "sheetMode": "first",
  "matrix": {
    "headerRowIndex": 0,
    "dataStartRowIndex": 1,
    "fixedColumns": {
      "skuName": 2,
      "skuCode": 3,
      "skuSpec": 7
    },
    "matrixStartColumnIndex": 13,
    "matrixEndColumnIndex": 18
  },
  "mappings": [
    { "kind": "column", "field": "skuName", "columnIndex": 2 },
    { "kind": "column", "field": "skuCode", "columnIndex": 3 },
    { "kind": "matrixColumn", "field": "storeName" },
    { "kind": "compoundPart", "field": "skuQuantity", "part": "quantity" }
  ]
}
```

当前验证：15 行，5 单，0 问题。

### 6.4 黔寨寨配送单 PDF

本地 demo：

```text
demos/黔寨寨贵州烙锅（鞍山店）常温.pdf
```

推荐方式：

- AI 生成规则。
- 或选择“通用 PDF/Word 编号文本规则”后微调正则。

配置要点：

- `layout: textBlocks`
- 收货信息从 PDF 文本标签提取。
- SKU 行使用 `itemLinePattern`。
- 合计行、签字行需要跳过。

示例片段：

```json
{
  "sourceKind": "pdf",
  "layout": "textBlocks",
  "sectionSeparatorPattern": "\\n\\s*\\n",
  "itemLinePattern": "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
  "mappings": [
    { "kind": "regex", "field": "externalCode", "pattern": "(?:外部编码|配送单号|订单号|单据编号|单号)[:：\\s]*([A-Za-z0-9_-]+)", "group": 1, "scope": "document" },
    { "kind": "regex", "field": "storeName", "pattern": "(?:门店|收货门店|收货单位|收货机构)[:：\\s]*([^\\n]+)", "group": 1, "scope": "document" }
  ]
}
```

当前验证：38 行，1 单，0 问题。

### 6.5 多门店分 Sheet 出库单

本地 demo：

```text
demos/多门店分Sheet出库单.xlsx
```

推荐方式：

- AI 生成规则。
- 或选择“通用多 Sheet 表格规则”后微调尾部单元格。

配置要点：

- `layout: tabular`
- `sheetMode: all`
- 每个 Sheet 独立解析后合并。
- 每个 Sheet 底部横向排列收货人、电话、地址，可用 `cell`。

示例片段：

```json
{
  "layout": "tabular",
  "sheetMode": "all",
  "headerRowIndex": 2,
  "dataStartRowIndex": 3,
  "stopWhenRowMatches": "合计|总计|小计",
  "mappings": [
    { "kind": "column", "field": "skuCode", "columnIndex": 1 },
    { "kind": "column", "field": "skuName", "columnIndex": 2 },
    { "kind": "column", "field": "skuSpec", "columnIndex": 3 },
    { "kind": "column", "field": "skuQuantity", "columnIndex": 5 },
    { "kind": "cell", "field": "storeName", "rowIndex": 11, "columnIndex": 1 },
    { "kind": "cell", "field": "recipientPhone", "rowIndex": 12, "columnIndex": 1 }
  ]
}
```

当前验证：21 行，3 单，0 问题。

### 6.6 门店调拨单卡片式

本地 demo：

```text
demos/门店调拨单-卡片式.xlsx
```

推荐方式：

- AI 生成规则。
- 或选择“通用卡片式调拨规则”后微调 `sectionStartPattern` 和 `itemLinePattern`。

配置要点：

- `layout: cards`
- 用“调拨记录”识别卡片边界。
- 区块内用 `scope: section` 抽取门店、收货人、电话、地址。
- `itemLinePattern` 第 3 捕获组是规格，第 4 捕获组是数量，避免把 `750ml/2.5kg/25kg` 当成数量。

示例片段：

```json
{
  "layout": "cards",
  "sectionStartPattern": "调拨记录",
  "sectionSeparatorPattern": "调拨记录",
  "itemLinePattern": "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
  "mappings": [
    { "kind": "regex", "field": "externalCode", "pattern": "(?:调拨单号|单号)[:：\\s]*([A-Za-z0-9_-]+)", "group": 1, "scope": "document" },
    { "kind": "regex", "field": "storeName", "pattern": "调入门店\\s*(?:\\|\\s*)?\\[?\\d*\\]?\\s*([^|\\n]+)", "group": 1, "scope": "section" }
  ]
}
```

当前验证：9 行，3 单，0 问题。

### 6.7 门店配送确认单 Word 纯文本

当前本地真实 demos 未包含该 Word 文件，`npm run smoke` 使用合成 DOCX 覆盖。

推荐方式：

- 选择“通用 PDF/Word 编号文本规则”。
- 或 AI 生成 `textBlocks` 规则。

配置要点：

- `sourceKind: word`
- `layout: textBlocks`
- 用分隔线或空行拆段。
- 物品行格式类似“编号. 编码 | 名称 | 规格 | 数量”。

示例片段：

```json
{
  "sourceKind": "word",
  "layout": "textBlocks",
  "sectionSeparatorPattern": "━{3,}|-{5,}|\\n\\s*\\n",
  "itemLinePattern": "(?:\\d+[\\.]\\s*)?([A-Za-z0-9_-]{2,})\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*([^|\\n]+?)\\s*\\|\\s*(\\d+(?:\\.\\d+)?)",
  "mappings": [
    { "kind": "regex", "field": "externalCode", "pattern": "(?:订单号|配送单号|Order)[:：\\s]*([A-Za-z0-9_-]+)", "group": 1, "scope": "section" }
  ]
}
```

自动化验证：2 行，1 单，0 问题。

### 6.8 周配送计划

当前本地真实 demos 未包含该文件，`npm run smoke` 使用合成 Excel 覆盖。

推荐方式：

- 选择“通用周计划双重转置规则”。
- 根据实际列数微调 `matrixStartColumnIndex` 和固定列。

配置要点：

- `layout: matrix`
- 门店在纵向固定列。
- 日期在横向列头。
- 单元格内多个“物品名x数量”拆成多行。
- 日期可写入 `remark`。

示例片段：

```json
{
  "layout": "matrix",
  "matrix": {
    "headerRowIndex": 0,
    "dataStartRowIndex": 1,
    "fixedColumns": { "storeName": 0 },
    "matrixStartColumnIndex": 1,
    "compoundSeparatorPattern": "\\n|；|;|、"
  },
  "mappings": [
    { "kind": "column", "field": "storeName", "columnIndex": 0 },
    { "kind": "matrixColumn", "field": "remark" },
    { "kind": "constant", "field": "skuCode", "value": "AUTO-SKU" },
    { "kind": "compoundPart", "field": "skuName", "part": "name" },
    { "kind": "compoundPart", "field": "skuQuantity", "part": "quantity" }
  ]
}
```

自动化验证：4 行，0 问题。

### 6.9 配送签收单多单 PDF

当前本地真实 demos 未包含该多单 PDF，规则引擎已支持 `multiSection`，`npm run smoke` 使用多订单文本覆盖分段聚合能力。

推荐方式：

- 上传真实多单 PDF 后，优先点击“AI 生成规则”。
- 如果手工配置，使用 `multiSection` 或 `textBlocks`。

配置要点：

- 通过“配送签收单”“Delivery Order”等起始标识切分多单。
- 每个区块内用 `scope: section` 抽取该单独立的收货人和 SKU 明细。
- `itemLinePattern` 不应匹配合计、签字、说明行。

示例片段：

```json
{
  "sourceKind": "pdf",
  "layout": "multiSection",
  "sectionStartPattern": "配送签收单|Delivery Order",
  "sectionSeparatorPattern": "━{3,}|-{5,}|(?=配送签收单)|(?=Delivery Order)",
  "itemLinePattern": "(?:\\d+[\\.、)]\\s*)?([A-Za-z0-9_-]{2,})\\s*[|｜\\s]+([^|｜\\n]+?)\\s*[|｜\\s]+(?:([^|｜\\n]+?)\\s*[|｜\\s]+)?(\\d+(?:\\.\\d+)?)",
  "mappings": [
    { "kind": "regex", "field": "externalCode", "pattern": "(?:配送单号|签收单号|Delivery Order)[:：\\s]*([A-Za-z0-9_-]+)", "group": 1, "scope": "section" },
    { "kind": "regex", "field": "recipientPhone", "pattern": "(?:电话|手机|Phone)[:：\\s]*([0-9\\-\\s]{7,20})", "group": 1, "scope": "section" }
  ]
}
```

当前说明：真实隐藏样本需要最终上传确认；规则设计和自动化分段聚合能力已覆盖。

## 7. AI 提示词配置建议

规则配置弹框中有“提示词配置”。建议保留默认提示词，并按场景补充一句具体要求：

- 表格类：不要扩大数据区，不要把合计/说明/尾部信息解析为 SKU。
- 矩阵类：列头代表门店或日期，非空交叉单元格才生成明细。
- 卡片类：必须按卡片边界拆分，收货信息使用 `scope=section`。
- 文本/PDF 类：只匹配真实物品行，签字/合计/页脚跳过。
- 多单 PDF：每个区块独立抽取收货信息，不能把第一单收货信息复用到所有单。

最终仍以服务端自检为准：AI 规则必须通过当前文件预解析，且错误数、字段覆盖、数量签名不能比参考规则明显变差。

## 8. 常见问题

AI 生成按钮不可点：

- 先上传文件。
- 先选择模型 Profile。
- Profile 必须有 Key 且启用。

解析全部按钮不可点：

- 先上传文件。
- 先选择已有规则，或在规则配置中 AI 生成/手工新增规则。
- 规则 JSON 必须包含 `mappings`。

提交按钮不可点：

- 必须先解析出明细。
- 全量校验结果不能有错误。

历史列表查不到：

- 确认提交成功。
- 点击“已导入”弹框里的“重置”。
- 检查查询关键词和提交日期范围。

生产环境模型不可用：

- 检查 Vercel 是否配置了 `DATABASE_URL`。
- 检查部署后的数据库是否已有 Profile。
- 在页面“模型配置”点击“测试连接”。
- 查看 Vercel Functions 日志里的 `[llm:test]` 或 `[llm:generate]` 脱敏日志。
