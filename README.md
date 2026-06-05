# 万能导入 V2

智能多格式批量下单系统，基于 Next.js App Router + TypeScript，面向 Excel / Word / PDF 复杂出库单导入。

## 功能覆盖

- 文件上传：支持 `.xlsx`、`.xls`、`.docx`、`.pdf`，支持点击和拖拽。
- 规则管理：创建、编辑、保存、复制、删除，规则持久化到服务端。
- AI 辅助：`/api/rules/generate` 抽取文件样本，请大模型生成可编辑解析规则；未配置 Key 时启用本地推荐规则兜底。
- 规则执行：解析过程只执行规则，不依赖文件名判断，也不为 demo 写专门 if-else。
- 人工确认：规则编辑区展示规则类型、置信度、字段映射数量和“需确认”推测点，保存前可试解析。
- 复杂结构：支持表头跳过、尾部键值提取、跨行聚合、矩阵转置、多 Sheet、文本/PDF 编号行、复合单元格拆分。
- 预览编辑：类 Excel 表格、固定表头、横向滚动、虚拟列表、单元格编辑、Tab / Enter / 方向键流转、新增行、删除行。
- 校验：SKU 必填、数量正数、电话格式、A/B 收货信息二选一、同批次重复、历史重复。
- 导出：预览数据可导出为 `.xlsx`。
- 提交：校验通过后按外部编码聚合 SKU，写入数据库。
- 历史列表：按外部编码/收件人/门店搜索，按提交时间筛选，分页展示。

## 本地运行

```bash
npm install
npm run dev
```

默认地址：

```bash
http://127.0.0.1:3000
```

## 环境变量

复制 `.env.example` 为 `.env.local`：

```bash
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
DATABASE_URL=
NEXT_PUBLIC_DATABASE_LABEL=Vercel Marketplace DB
```

说明：

- `LLM_API_KEY`：DeepSeek / GPT / Claude 兼容 Chat Completions 接口的密钥。
- `LLM_BASE_URL`：默认 `https://api.deepseek.com`，OpenAI 可配置为 `https://api.openai.com`。
- `LLM_MODEL`：默认 `deepseek-chat`。
- `DATABASE_URL`：Vercel Marketplace 集成 Neon / Supabase / Turso 后提供的连接串。
- 未配置 `DATABASE_URL` 时，开发环境使用 `data/local-store.json` 作为本地存储。

## Vercel 部署

1. 推送代码到 GitHub / GitLab / GITEE。
2. 在 Vercel 导入仓库。
3. 通过 Vercel Marketplace 集成 Neon / Supabase / Turso。
4. 在 Vercel Project Settings 配置环境变量：
   - `DATABASE_URL`
   - `LLM_API_KEY`
   - `LLM_BASE_URL`
   - `LLM_MODEL`
   - `NEXT_PUBLIC_DATABASE_LABEL`
5. 部署后访问 Vercel URL，确认首页、上传、生成规则、试解析、提交、历史列表可用。
6. 访问 `/api/health`，确认 `ok: true`、存储模式和默认规则数量正常。

## 大模型调用说明

模型调用集中在 `src/lib/llm.ts`：

- 系统提示词要求模型扮演“物流批量下单系统的解析规则架构师”。
- 用户消息包含文件类型、统计信息、结构样本和本地推荐规则示例。
- 模型输出必须是规则 JSON，不允许直接输出最终订单数据。
- 输出规则需包含 `assumptions`，标注哪些字段映射是推测的。
- 用户可在页面中人工微调规则，确认后保存。

这样设计的原因：AI 负责理解新格式并生成规则，规则引擎负责稳定、可复现地解析数据，避免每次导入都让 AI 直接“猜数据”。

## 验证命令

```bash
npm run typecheck
npm run lint
npm run build
```

启动本地服务后可执行端到端烟测：

```bash
npm run dev
npm run smoke
```

`npm run smoke` 会检查首页可达、`/api/health`、默认规则模板、真实 demo 解析、多 Sheet、周计划矩阵、卡片式调拨、1000 行性能、Excel 导出、提交下单和历史查询。

最近一次本地压测结果：1000 行标准 Excel 解析为 1000 行，规则执行约 16ms，规则生成接口往返约 146ms，解析接口往返约 108ms，不含 AI 时间。

## 提交清单

- 在线地址：https://aitest-murex.vercel.app
- 源码仓库：https://github.com/exayong609/test260605
- 大模型说明：见本 README 和 `docs/ai-and-rules.md`。
