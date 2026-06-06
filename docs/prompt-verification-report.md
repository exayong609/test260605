# AI 规则生成与验收报告

## 结论

本项目采用“AI 生成解析规则 + 规则引擎执行”的方案，而不是让 AI 直接返回订单数据。这样可以让规则可保存、可编辑、可复用，也能把每次导入的结果稳定复现出来。

当前本地回归结果显示：真实 demos 目录内 6 个文件全部可解析，且解析结果 0 个校验问题；补充的多 Sheet、矩阵转置、卡片式、Word 纯文本、多订单文本、1000 行性能、导出、提交和历史查询也已通过烟测。带 MiniMax-M3 Profile 的真实 AI 生成链路也已逐个跑通：本轮 5 个 demo 直接采用 LLM 规则，1 个 demo 因模型少抽 1 行被质量闸门安全回退到本地推荐规则，最终结果均为 0 错误。

## 和大模型交互的设计

系统提示词的目标不是“帮我解析这个文件”，而是“请生成一份规则引擎可执行的 ParsingRule JSON”。提示词中明确约束：

- 只允许输出规则 JSON，不输出最终订单数据。
- 只能使用系统定义的业务字段：externalCode、storeName、recipientName、recipientPhone、recipientAddress、skuCode、skuName、skuQuantity、skuSpec、remark。
- 明确 layout 选择：tabular、matrix、cards、textBlocks、multiSection。
- 明确 mapping kind：column、cell、regex、constant、sheetName、matrixColumn、compoundPart。
- 行号、列号使用 0 基索引。
- 不依赖文件名判断业务含义。
- 合计、小计、说明行不能解析为 SKU。
- 外部编码下的多个 SKU 行必须保留多行，由系统聚合。
- 必须填写 assumptions，标注推测映射，交给用户最终确认。

用户消息不直接上传完整大文件，而是发送压缩后的结构样本：

- 文件类型、sheet 数、行数、页数、字符数等统计信息。
- 每个 sheet 的头部样本行和尾部样本行。
- 文本类文件的头部文本和尾部文本。
- 本地推荐规则的简化结构。
- 本地推荐规则在当前样本上的试解析指标和样例行。

这样做的目的有三个：

- 降低 token 成本，避免大文件超上下文。
- 让模型参考可执行 DSL，而不是自由发挥。
- 用 fallbackSelfTestReference 约束模型，要求 AI 结果不能少解析有效 SKU 行，也不能明显多抽取无效行。

## 质量闸门

AI 返回后不会直接生效，而是先经过服务端自检：

- 解析 JSON，过滤不支持的字段和 mapping kind。
- 用生成规则对当前文件试解析。
- 和本地推荐规则的结果对比。
- 如果模型返回 JSON 不合法，服务端会把坏输出片段、JSON 错误、本地推荐规则和试解析指标发起一次二次修正；修正后的规则仍必须通过同一套自检才会被采纳。
- 如果模型返回合法 JSON 但试解析质量不达标，服务端会把失败原因、AI 试解析指标、本地参考指标和初版规则发起一次二次修正；修正后仍不达标才回退。
- 如果 AI 结果 0 行、错误明显更多、关键字段缺失更多、分组异常膨胀、或在本地规则 0 错误时多抽取超过 15%，自动回退到本地推荐规则。
- 如果行数和必填校验看似通过，但同一门店/SKU 的发货数量和参考规则明显不一致，也会回退，避免把规格里的数字误当成数量。
- 如果参考规则能抽到收货电话、地址、外部编码、规格等有用字段，而 AI 规则覆盖率明显下降，也会回退，避免“合法但信息更少”的规则被采纳。
- 回退原因会写入 assumptions，用户在规则配置弹框中可以看到。

这层闸门是提高准确率的关键。早期实测中，MiniMax 对干扰头 Excel 会多抽说明/尾部行，对卡片式文件会漏掉 `skuSpec` 或把规格数字误当数量；浏览器实测还捕获到一次模型输出 JSON 不合法的波动。当前处理方式不是放宽校验，而是先二次修正，再用同一套质量闸门判断是否采纳。最新真实 AI 生成审计中，5 个 demo 直接采用 LLM 规则，`湖南仓.xlsx` 因 AI 少抽 1 行被安全回退；这说明规则自检和 fallback 不能去掉，否则模型波动会影响导入结果。

## MiniMax 接入

已支持三种协议：

- openai-compatible
- anthropic-compatible
- minimax-native

MiniMax 原生调用使用 `POST /v1/text/chatcompletion_v2`，请求体包含 `model`、`messages`、`temperature`、`max_completion_tokens`。API Key 只保存在服务端数据库或环境变量中，前端列表只返回 `hasApiKey`，不会把密钥回传给页面。

本轮实际接入 MiniMax-M3 时发现：复杂 Excel/PDF 场景会把输出预算大量消耗在 reasoning 内容上，出现 `finish_reason=length` 且 `content` 为空，导致 AI 生成规则回退。当前处理方式：

- 对 MiniMax-M3 显式传入 `thinking: { type: "disabled" }` 和 `reasoning_split: false`，让模型优先输出最终规则 JSON。
- 将规则生成阶段的 `max_completion_tokens` 提高，避免复杂规则 JSON 被截断。
- 在系统提示词第一段明确“不要输出分析过程，只输出最终 JSON”。
- 提示词禁止在 description/name/assumptions 字符串内部使用英文双引号；服务端也会对这类常见 JSON 字符串引号错误做轻量修复。
- 保留服务端自检，不因模型成功返回 JSON 就直接采用。

这样调整后，MiniMax-M3 能更稳定返回规则；但仍以自检结果决定最终采用 AI 规则还是本地推荐规则。

服务端会打印脱敏日志：

- `[llm:test:start]`
- `[llm:test]`
- `[llm:test:error]`
- `[llm:generate:start]`
- `[llm:generate]`
- `[llm:generate:error]`
- `[llm:generate:self-test-fallback]`

日志包含 protocol、model、endpoint、HTTP 状态、响应 key、contentPreview、rawPreview、base_resp 等信息，不打印 API Key。

## 真实 demos 回归结果

最近一次 `npm run smoke`：

| 场景 | layout | 行数 | 问题数 |
| --- | --- | ---: | ---: |
| 干扰头部 + 尾部收货信息 Excel | tabular | 2 | 0 |
| 多门店分 Sheet Excel | tabular | 21 | 0 |
| 门店矩阵转置 Excel | matrix | 15 | 0 |
| 湖南仓明细 Excel | tabular | 167 | 0 |
| 门店调拨卡片式 Excel | cards | 9 | 0 |
| PDF 编号文本行 | textBlocks | 38 | 0 |

带 MiniMax-M3 Profile 的真实 AI 生成审计：

| 场景 | provider | layout | 行数 | 分组 | 问题数 |
| --- | --- | --- | ---: | ---: | ---: |
| 干扰头部 + 尾部收货信息 Excel | llm | tabular | 2 | 1 | 0 |
| 多门店分 Sheet Excel | llm | tabular | 21 | 3 | 0 |
| 门店矩阵转置 Excel | llm | matrix | 15 | 5 | 0 |
| 湖南仓明细 Excel | fallback | tabular | 167 | 61 | 0 |
| 门店调拨卡片式 Excel | llm | cards | 9 | 3 | 0 |
| PDF 编号文本行 | llm | textBlocks | 38 | 1 | 0 |

本轮重点修正了三类隐形错误：干扰头 Excel 曾被 AI 扩大数据区导致多抽非明细行；卡片式文件曾因 AI 正则不完整导致 `skuSpec` 覆盖率下降，并可能把 `750ml/2.5kg/25kg` 等规格数字误当发货数量；MiniMax 偶发返回不合法 JSON。当前提示词已明确要求贴合 `fallbackSelfTestReference`、不扩大数据区凑行数、`itemLinePattern` 第 3 捕获组必须提取规格、第 4 捕获组才是数量；服务端还增加了坏规则/坏 JSON 的二次修正流程。最新真实 MiniMax 审计中，这些场景均能得到通过自检的 LLM 规则或安全回退；例如 `湖南仓.xlsx` 初版 AI 少抽 1 行，最终自动保留 167 行、0 错误的本地推荐规则。

补充覆盖：

| 场景 | 结果 |
| --- | --- |
| 多 Sheet 合并 | 2 行，2 个门店 |
| 通用标准规则解析干扰头 Excel | 2 行，外部编码和尾部收货电话正确 |
| 周计划双重转置 | 4 行 |
| 卡片式分段 | 3 行，2 单 |
| Word 纯文本 | 2 行，1 单 |
| 多订单文本 | 3 行，2 单 |
| 1000 行性能 | 1000 行，规则引擎约 17-19ms，接口往返小于 1 秒 |
| 导出 | 返回 xlsx |
| 提交与历史 | 可写入数据库并查询 |
| 重复校验 | 同一外部编码下多 SKU 正常聚合；历史外部编码重复拒绝；同批次同外部编码+同目的地+同 SKU 明细重复拒绝 |

题面 9 类场景覆盖矩阵：

| 题面场景 | 当前证据 | 说明 |
| --- | --- | --- |
| 黎明屯配送发货单 | 真实 demo + MiniMax AI 审计 | 干扰头部、合计行跳过、尾部横向收货信息，2 行 1 单 0 问题 |
| 湖南仓发货明细 | 真实 demo + MiniMax AI 审计 | 167 行明细，按配送单号聚合为 61 单，0 问题 |
| 欢乐牧场模板 | 真实 demo + MiniMax AI 审计 | SKU x 门店矩阵转置，15 行 5 单 0 问题 |
| 黔寨寨配送单 | 真实 PDF demo + MiniMax AI 审计 | PDF 文本解析，38 行 1 单 0 问题 |
| 多门店分 Sheet 出库单 | 真实 demo + MiniMax AI 审计 | 遍历 3 个 Sheet，21 行 3 单 0 问题 |
| 门店调拨单卡片式 | 真实 demo + MiniMax AI 审计 | 按调拨记录切分卡片，9 行 3 单 0 问题 |
| 门店配送确认单 Word 纯文本 | 合成 DOCX smoke | 纯文本段落和物品行正则，2 行 1 单 0 问题 |
| 周配送计划 | 合成 Excel smoke | 日期/门店矩阵 + 复合单元格拆分，4 行 0 问题 |
| 配送签收单多单 PDF | 引擎能力覆盖 + 多订单文本 smoke | `multiSection` 支持按起始标识拆多单；当前本地未拿到真实多单 PDF 文件，自动化用多订单文本验证分段聚合，真实 PDF 隐藏样本仍需最终人工上传确认 |

本轮还补了一个真实 UI 主流程风险点：用户上传干扰头 Excel 后直接选择“通用标准表格规则”，现在规则引擎会在前 20 行扫描表头，并从文档/尾部标签提取外部编码、收货人、电话、地址。浏览器实测路径“上传 -> 选择通用标准表格规则 -> 解析全部文件”得到 2 行、1 单、0 错误。

## 提示词优化结论

最有效的提示词不是长篇讲业务背景，而是把“可执行规则的边界”讲清楚：

1. 先定义角色：你是解析规则设计助手，不是数据抽取助手。
2. 再定义输出物：只能返回 ParsingRule JSON。
3. 再定义字段白名单和 mapping 白名单，降低幻觉字段。
4. 再定义复杂结构选择：表格、矩阵、卡片、纯文本、多段。
5. 再给少量结构样本，而不是全量文件。
6. 再给 fallback 规则和 fallback 试解析结果，作为质量下限。
7. 最后强制 assumptions，让模型标注推测点，便于人工确认。

如果继续优化，优先方向是：

- 对 PDF 长文本做更强摘要，分离“结构识别样本”和“尾部收货信息样本”。
- 对卡片式文件在 prompt 中强调 stopWhenRowMatches 和 itemLinePattern 的边界，防止把合计或说明行当 SKU；当前已补充 `skuSpec`/`skuQuantity` 捕获组边界和数量签名约束。
- 对模型输出增加更严格的 schema 校验，例如 zod 校验每种 layout 必填字段。
- 在 UI 中展示“AI 原始推荐”和“系统自检后采用规则”的差异，让用户更容易理解为什么 fallback；当前服务端日志和 assumptions 已带具体回退原因。

本轮实测后的最终建议：

- 提示词要让模型生成“规则”，不要让模型生成“数据”。数据解析交给可复现的规则引擎。
- 用户消息要包含结构样本、本地推荐规则和本地试解析指标，给模型一个质量下限。
- 对推理型模型要压制长篇分析输出，优先保证合法 JSON。
- 质量闸门必须比提示词更重要：只要本地规则 0 错误，而 AI 规则出现错误、少抽取、明显多抽取、分组异常、数量签名不一致或字段覆盖明显下降，就先二次修正；修正仍失败才自动回退。
- 规则编辑 UI 里要把 assumptions 展示给用户，让用户知道哪些映射是推测的。

## 题目要求核对

已达到：

- Next.js App Router + TypeScript。
- 规则持久化存储，支持创建、编辑、删除、复制。
- 上传时手动选择规则，不做自动匹配。
- 支持 AI 生成规则，且用户可在保存前预解析、微调、确认。
- 规则引擎覆盖 tabular、matrix、cards、textBlocks、multiSection。
- 支持 Excel、Word、PDF。
- 支持预览编辑、新增行、删除行、导出、提交、历史查询、分页。
- 支持数据库持久化和模型 Profile 持久化。
- 支持大模型 Profile 新增、编辑、删除、测试连接。
- 支持 1000 行性能要求。
- 服务端日志可看到 AI 响应摘要。

仍需最终人工验收：

- Vercel 部署后的环境变量是否完整，包括 `DATABASE_URL` 和模型 Profile/API Key。
- 部署后是否在 Vercel 日志中能看到同样的 LLM 脱敏日志。
- UI 在真实部署地址上的浏览器表现是否与本地一致。
- 题面写 9 份 demo，但当前本地 `demos` 目录实际有 6 个真实文件；Word 纯文本、多订单文本/PDF、复合单元格等缺口已用合成用例覆盖。若评测方提供额外第 7、8、9 个隐藏 demo，应优先通过 AI 生成规则 + 预解析微调，而不是改代码。
- 题面副标题提到“钉钉预警”，但正文模块和评分细则未列出 webhook/告警要求；当前未实现独立钉钉预警模块。
