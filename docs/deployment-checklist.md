# 部署与提交清单

## 需要提供的信息

部署到 Vercel 前需要以下信息：

- Vercel 账号访问方式，或已经创建好的 Vercel 项目。
- Git 远程仓库地址，GitHub / GitLab / GITEE 均可。
- 数据库连接串 `DATABASE_URL`，建议通过 Vercel Marketplace 集成 Neon / Supabase / Turso。
- 大模型密钥 `LLM_API_KEY`。
- 大模型接口地址 `LLM_BASE_URL`，例如 `https://api.deepseek.com`。
- 大模型名称 `LLM_MODEL`，例如 `deepseek-chat`。

## Vercel 环境变量

```bash
DATABASE_URL=
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
NEXT_PUBLIC_DATABASE_LABEL=Vercel Marketplace DB
```

## 部署前本地验证

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

启动服务后执行端到端烟测：

```bash
npm run dev
npm run smoke
```

也可通过环境变量指定线上地址：

```bash
SMOKE_BASE_URL=https://your-vercel-url.vercel.app npm run smoke
```

## 部署后验收路径

1. 打开 Vercel 在线 URL，确认首页正常加载。
2. 访问 `/api/health`，确认 `ok: true`。
3. 上传 Excel 样例，点击“新建规则”，确认能生成可编辑规则。
4. 保存规则后点击“试解析”，确认预览表格有数据。
5. 修改一个单元格，确认实时校验更新。
6. 导出 Excel，确认下载文件可打开。
7. 提交下单，确认成功 N 条、失败 0 条。
8. 到“已导入运单”搜索外部编码，确认历史记录可查。
9. 使用时间筛选和分页按钮，确认历史列表响应正常。

## 考试提交内容

- Vercel 在线地址。
- 源码仓库链接。
- 大模型调用说明：见 `README.md` 和 `docs/ai-and-rules.md`。

## 当前本地验证记录

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run smoke`：通过。
- 健康检查：`/api/health` 返回 `ok: true`，默认规则数量 6。
- 导出烟测：`/api/export` 返回 `.xlsx` 文件。
- 真实 demo 烟测：
  - Excel 表格尾部收货信息：解析 2 行。
  - Excel 多门店分 Sheet 出库单：解析 21 行。
  - Excel 门店矩阵：解析 15 行。
  - Excel 湖南仓汇总明细：解析 167 行。
  - Excel 卡片式调拨单：解析 9 行。
  - PDF 编号文本：解析 38 行。
- 合成复杂格式烟测：
  - 多 Sheet 表格：解析 2 行，Sheet 名映射为门店。
  - 周计划双重转置：解析 4 行，复合单元格拆分正常。
  - 卡片式调拨：解析 3 行，聚合为 2 个外部单号。
- 1000 行标准 Excel：解析 1000 行，规则执行约 16ms，规则生成接口往返约 146ms，解析接口往返约 108ms。
