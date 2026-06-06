# 部署与提交清单

## 提交前本地验证

```bash
npm run typecheck
npm run lint
npm run build
```

启动本地服务后执行：

```bash
npm run dev
npm run smoke
```

线上也可以通过环境变量指定地址：

```bash
SMOKE_BASE_URL=https://your-vercel-url.vercel.app npm run smoke
```

## Vercel 环境变量

必须配置：

```bash
DATABASE_URL=
NEXT_PUBLIC_DATABASE_LABEL=Vercel Marketplace DB
```

如果使用环境变量作为默认模型配置，再配置：

```bash
LLM_API_KEY=
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat
LLM_PROTOCOL=openai-compatible
```

如果使用页面里的“模型配置”维护 Profile，也需要确认部署后的数据库里已有可用 Profile，或上线后在页面中新增。

MiniMax 原生 Profile 示例：

```bash
protocol=minimax-native
baseUrl=https://api.minimaxi.com/v1/text/chatcompletion_v2
model=MiniMax-M3
```

## 部署后验收路径

1. 打开 Vercel URL，确认首页正常加载。
2. 访问 `/api/health`，确认 `ok: true`、`storage: database`。
3. 打开“模型配置”，确认 Profile 列表可查询，点击“测试连接”返回成功。
4. 上传 demos 中的 Excel 文件，打开“规则配置”，点击 AI 生成规则。
5. 查看规则 JSON、assumptions、解析预览，确认用户可以微调后保存。
6. 回到主页点击“解析全部文件”，确认预览表格出现明细。
7. 修改一个单元格，确认实时校验结果更新。
8. 新增行、删除行、分页、横向滚动都能正常操作。
9. 导出 Excel，确认文件可下载。
10. 提交下单，确认成功记录写入数据库。
11. 打开“已导入”，使用查询、重置、分页和查看详情。

## 当前本地验证记录

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm run smoke`：通过。
- MiniMax Profile 测试：通过。
- MiniMax 小 Excel AI 生成规则：`provider=llm`，解析 2 行，0 个问题。
- 真实 demos 6 个文件全部解析成功，0 个问题。
- 真实 demos 带 MiniMax Profile 回归：5 个 `provider=llm`，1 个因少抽 1 行触发质量闸门 `provider=fallback`，最终全部 0 问题。
- 1000 行标准 Excel：解析 1000 行，规则引擎约 15ms。

## 提交材料

- Vercel 在线地址。
- GitHub 源码仓库地址。
- 使用与场景配置说明：见 `docs/usage-guide.md`。
- 大模型调用说明：见 `README.md`、`docs/ai-and-rules.md`、`docs/prompt-verification-report.md`。
