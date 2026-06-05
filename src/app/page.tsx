"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Trash2,
  Wand2
} from "lucide-react";
import { ORDER_FIELD_LABELS, ORDER_FIELDS } from "@/lib/fields";
import { makeId } from "@/lib/ids";
import { validateRows } from "@/lib/validation";
import type { IntermediateDocument, OrderField, OrderGroup, ParsedOrderRow, ParseResult, ParsingRule, ValidationIssue } from "@/types";

type Toast = { kind: "success" | "error" | "info"; text: string };
type HistoryState = { items: OrderGroup[]; total: number };
type HistoryFilters = { query: string; from: string; to: string; page: number; pageSize: number };
type HealthState = {
  ok: boolean;
  storage: "database" | "local-json";
  llmConfigured: boolean;
  defaultRuleCount: number;
};

const editableFields = ORDER_FIELDS;

function isIssueFor(issues: ValidationIssue[], rowId: string, field: OrderField) {
  return issues.some((issue) => issue.rowId === rowId && issue.field === field && issue.severity === "error");
}

function formatMs(ms?: number) {
  if (ms === undefined) return "-";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function parseRuleDraft(ruleDraft: string) {
  try {
    return JSON.parse(ruleDraft) as ParsingRule;
  } catch {
    return null;
  }
}

export default function Home() {
  const [rules, setRules] = useState<ParsingRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [ruleDraft, setRuleDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [documentInfo, setDocumentInfo] = useState<IntermediateDocument | null>(null);
  const [rows, setRows] = useState<ParsedOrderRow[]>([]);
  const [serverIssues, setServerIssues] = useState<ValidationIssue[]>([]);
  const [history, setHistory] = useState<HistoryState>({ items: [], total: 0 });
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>({ query: "", from: "", to: "", page: 1, pageSize: 20 });
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState<Toast | null>(null);
  const [aiProvider, setAiProvider] = useState<"llm" | "fallback" | null>(null);
  const [progressDetail, setProgressDetail] = useState("");
  const [health, setHealth] = useState<HealthState | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedRuleId), [rules, selectedRuleId]);
  const ruleSummary = useMemo(() => parseRuleDraft(ruleDraft), [ruleDraft]);
  const clientIssues = useMemo(() => validateRows(rows), [rows]);
  const persistentServerIssues = serverIssues.filter((issue) => issue.id.includes("external_duplicate_existing"));
  const issues = rows.length ? [...clientIssues, ...persistentServerIssues] : serverIssues;
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const groupsCount = useMemo(() => new Set(rows.map((row) => row.externalCode || row.id)).size, [rows]);
  const historyTotalPages = Math.max(1, Math.ceil(history.total / historyFilters.pageSize));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 42,
    overscan: 12
  });

  const showToast = useCallback((kind: Toast["kind"], text: string) => {
    setToast({ kind, text });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadRules = useCallback(async () => {
    const response = await fetch("/api/rules", { cache: "no-store" });
    const data = await response.json();
    setRules(data.rules || []);
    if (!selectedRuleId && data.rules?.[0]) {
      setSelectedRuleId(data.rules[0].id);
      setRuleDraft(JSON.stringify(data.rules[0], null, 2));
    }
  }, [selectedRuleId]);

  const loadHistory = useCallback(async () => {
    const params = new URLSearchParams({
      query: historyFilters.query,
      from: historyFilters.from,
      to: historyFilters.to,
      page: String(historyFilters.page),
      pageSize: String(historyFilters.pageSize)
    });
    const response = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    setHistory({ items: data.items || [], total: data.total || 0 });
  }, [historyFilters]);

  const loadHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const data = (await response.json()) as HealthState;
      setHealth(response.ok && data.ok ? data : null);
    } catch {
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    loadRules();
    loadHistory();
    loadHealth();
  }, [loadRules, loadHistory, loadHealth]);

  useEffect(() => {
    if (selectedRule) setRuleDraft(JSON.stringify(selectedRule, null, 2));
  }, [selectedRule]);

  async function runWithProgress<T>(label: string, task: () => Promise<T>) {
    setBusy(label);
    setProgress(8);
    const timer = window.setInterval(() => setProgress((value) => Math.min(92, value + Math.random() * 14)), 220);
    try {
      const result = await task();
      setProgress(100);
      return result;
    } finally {
      window.clearInterval(timer);
      window.setTimeout(() => {
        setBusy("");
        setProgress(0);
        setProgressDetail("");
      }, 420);
    }
  }

  function acceptFile(next: File | null) {
    setFile(next);
    setRows([]);
    setServerIssues([]);
    setDocumentInfo(null);
    setProgressDetail("");
  }

  async function generateRule() {
    if (!file) {
      showToast("error", "请先选择一个文件。");
      return;
    }
    await runWithProgress("AI 正在分析文件并生成规则", async () => {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/rules/generate", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "生成规则失败");
      setDocumentInfo(data.document);
      setAiProvider(data.provider);
      setRuleDraft(JSON.stringify(data.rule, null, 2));
      setSelectedRuleId("");
      showToast(data.provider === "llm" ? "success" : "info", data.provider === "llm" ? "AI 已生成推荐规则。" : "未配置大模型 Key，已使用本地推荐规则。");
    }).catch((error) => showToast("error", error.message));
  }

  async function saveCurrentRule() {
    try {
      const parsed = JSON.parse(ruleDraft) as ParsingRule;
      const response = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存规则失败");
      await loadRules();
      setSelectedRuleId(data.rule.id);
      showToast("success", "规则已保存。");
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "规则 JSON 不合法。");
    }
  }

  async function deleteCurrentRule() {
    if (!selectedRuleId) return;
    const response = await fetch(`/api/rules?id=${selectedRuleId}`, { method: "DELETE" });
    if (response.ok) {
      setSelectedRuleId("");
      setRuleDraft("");
      await loadRules();
      showToast("success", "规则已删除。");
    }
  }

  function copyRule() {
    try {
      const parsed = JSON.parse(ruleDraft) as ParsingRule;
      const now = new Date().toISOString();
      const copied = { ...parsed, id: makeId("rule"), name: `${parsed.name} 副本`, createdAt: now, updatedAt: now };
      setSelectedRuleId("");
      setRuleDraft(JSON.stringify(copied, null, 2));
      showToast("info", "已复制为新规则草稿。");
    } catch {
      showToast("error", "当前规则 JSON 不合法，无法复制。");
    }
  }

  async function parseWithRule() {
    if (!file) {
      showToast("error", "请先选择文件。");
      return;
    }
    if (!ruleDraft.trim()) {
      showToast("error", "请先选择或生成规则。");
      return;
    }
    await runWithProgress("正在按规则解析文件", async () => {
      const parsedRule = JSON.parse(ruleDraft) as ParsingRule;
      const form = new FormData();
      form.append("file", file);
      form.append("rule", JSON.stringify(parsedRule));
      const response = await fetch("/api/parse", { method: "POST", body: form });
      const data = (await response.json()) as { document?: IntermediateDocument; result?: ParseResult; error?: string };
      if (!response.ok) throw new Error(data.error || "解析失败");
      setDocumentInfo(data.document || null);
      setRows(data.result?.rows || []);
      setServerIssues(data.result?.issues || []);
      setProgressDetail(`已处理 ${data.result?.rows.length || 0}/${data.result?.rows.length || 0} 条`);
      showToast("success", `解析完成：${data.result?.rows.length || 0} 行，耗时 ${formatMs(data.result?.elapsedMs)}。`);
    }).catch((error) => showToast("error", error.message));
  }

  function updateCell(rowId: string, field: OrderField, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: field === "skuQuantity" ? Number(value) : value
            }
          : row
      )
    );
  }

  function focusCell(rowIndex: number, fieldIndex: number) {
    const nextRowIndex = Math.max(0, Math.min(rows.length - 1, rowIndex));
    const nextFieldIndex = Math.max(0, Math.min(editableFields.length - 1, fieldIndex));
    virtualizer.scrollToIndex(nextRowIndex, { align: "auto" });
    window.setTimeout(() => {
      const selector = `[data-row-index="${nextRowIndex}"][data-field-index="${nextFieldIndex}"]`;
      const input = parentRef.current?.querySelector<HTMLInputElement>(selector);
      input?.focus();
      input?.select();
    }, 30);
  }

  function handleCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, fieldIndex: number) {
    const lastFieldIndex = editableFields.length - 1;
    if (event.key === "Tab") {
      event.preventDefault();
      const step = event.shiftKey ? -1 : 1;
      const flatIndex = rowIndex * editableFields.length + fieldIndex + step;
      const maxIndex = rows.length * editableFields.length - 1;
      const nextFlatIndex = Math.max(0, Math.min(maxIndex, flatIndex));
      focusCell(Math.floor(nextFlatIndex / editableFields.length), nextFlatIndex % editableFields.length);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      focusCell(event.shiftKey ? rowIndex - 1 : rowIndex + 1, fieldIndex);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusCell(rowIndex + 1, fieldIndex);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusCell(rowIndex - 1, fieldIndex);
    }
    if (event.key === "ArrowRight" && event.currentTarget.selectionStart === event.currentTarget.value.length) {
      event.preventDefault();
      focusCell(rowIndex, fieldIndex + 1 > lastFieldIndex ? lastFieldIndex : fieldIndex + 1);
    }
    if (event.key === "ArrowLeft" && event.currentTarget.selectionStart === 0) {
      event.preventDefault();
      focusCell(rowIndex, fieldIndex - 1);
    }
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: makeId("row"),
        rowNumber: current.length + 1,
        skuCode: "",
        skuName: "",
        skuQuantity: 0
      }
    ]);
  }

  function deleteRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, rowNumber: index + 1 })));
  }

  async function exportRows() {
    if (!rows.length) return;
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows })
    });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-${Date.now()}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function submitRows() {
    if (!rows.length) return;
    if (errorCount > 0) {
      showToast("error", "存在错误行，请修正后再提交。");
      return;
    }
    await runWithProgress("正在提交下单", async () => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows })
      });
      const data = await response.json();
      if (!response.ok) {
        setServerIssues(data.issues || []);
        throw new Error(data.issues?.[0]?.message || data.error || "提交失败");
      }
      await loadHistory();
      showToast("success", `提交成功 ${data.successCount} 单，失败 ${data.failureCount} 单。`);
    }).catch((error) => showToast("error", error.message));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">智能多格式批量下单系统</div>
          <h1>万能导入 V2</h1>
        </div>
        <div className="topbar-actions">
          <span className={`pill ${health?.storage === "database" ? "ok" : "warn"}`}>
            <Database size={15} />
            {health ? (health.storage === "database" ? "数据库已连接" : "本地开发存储") : "健康检查中"}
          </span>
          <span className={`pill ${health?.llmConfigured ? "ok" : "warn"}`}>
            <Wand2 size={15} />
            {health?.llmConfigured ? "LLM 已配置" : "LLM 未配置"}
          </span>
          <span className="pill"><CheckCircle2 size={15} />模板 {health?.defaultRuleCount ?? rules.length}</span>
          <button className="ghost-button" onClick={() => { void loadHealth(); void loadHistory(); }}><RefreshCw size={16} />刷新</button>
        </div>
      </header>

      {busy && (
        <div className="progress-wrap">
          <div className="progress-copy"><Loader2 size={16} className="spin" />{busy}<span>{progressDetail || `${Math.round(progress)}%`}</span></div>
          <div className="progress-track"><div style={{ width: `${progress}%` }} /></div>
        </div>
      )}

      <section className="dashboard-grid">
        <aside className="panel import-panel">
          <div className="panel-title"><FileSpreadsheet size={18} />文件导入</div>
          <label
            className="drop-zone"
            onDragOver={(event) => {
              event.preventDefault();
              event.currentTarget.classList.add("dragging");
            }}
            onDragLeave={(event) => {
              event.currentTarget.classList.remove("dragging");
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove("dragging");
              acceptFile(event.dataTransfer.files?.[0] || null);
            }}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.docx,.pdf"
              onChange={(event) => {
                acceptFile(event.target.files?.[0] || null);
              }}
            />
            <FileSpreadsheet size={30} />
            <strong>{file ? file.name : "拖拽或点击上传文件"}</strong>
            <span>支持 Excel、Word、PDF；规则需手动选择或新建</span>
          </label>

          <div className="field">
            <label>选择已有规则</label>
            <select value={selectedRuleId} onChange={(event) => setSelectedRuleId(event.target.value)}>
              <option value="">新建/草稿规则</option>
              {rules.map((rule) => (
                <option key={rule.id} value={rule.id}>{rule.name}</option>
              ))}
            </select>
          </div>

          <div className="button-row">
            <button onClick={() => void generateRule()} disabled={Boolean(busy)}><Wand2 size={16} />新建规则</button>
            <button className="secondary" onClick={() => void parseWithRule()} disabled={Boolean(busy)}><CheckCircle2 size={16} />试解析</button>
          </div>

          {documentInfo && (
            <div className="doc-stats">
              <span>{documentInfo.sourceKind.toUpperCase()}</span>
              <span>{documentInfo.stats.sheetCount} Sheet</span>
              <span>{documentInfo.stats.rowCount} 行</span>
              <span>{documentInfo.stats.charCount} 字符</span>
            </div>
          )}

          <div className="panel-title small"><Wand2 size={17} />规则编辑</div>
          {ruleSummary && (
            <div className="rule-summary">
              <div className="rule-summary-head">
                <strong>{ruleSummary.name}</strong>
                <span>{ruleSummary.aiGenerated ? "AI 生成" : aiProvider === "fallback" ? "本地推荐" : "规则模板"}</span>
              </div>
              <div className="rule-meta-grid">
                <span>类型：{ruleSummary.layout}</span>
                <span>格式：{ruleSummary.sourceKind}</span>
                <span>Sheet：{ruleSummary.sheetMode || "first"}</span>
                <span>置信度：{Math.round((ruleSummary.confidence ?? 0) * 100)}%</span>
                <span>映射：{ruleSummary.mappings.length} 个</span>
                <span>聚合：{ruleSummary.groupBy || "未配置"}</span>
              </div>
              {Boolean(ruleSummary.assumptions?.length) && (
                <div className="assumption-list">
                  {ruleSummary.assumptions!.slice(0, 4).map((assumption, index) => (
                    <div key={`${assumption}_${index}`}>需确认：{assumption}</div>
                  ))}
                </div>
              )}
            </div>
          )}
          <textarea
            className="rule-editor"
            value={ruleDraft}
            onChange={(event) => setRuleDraft(event.target.value)}
            placeholder="生成或选择规则后，可在这里人工微调确认..."
          />
          {aiProvider && <div className="hint">{aiProvider === "llm" ? "当前规则来自大模型推荐，保存后生效。" : "当前为本地推荐规则；配置 LLM_API_KEY 后可调用大模型。"}</div>}
          <div className="button-row">
            <button onClick={() => void saveCurrentRule()} disabled={!ruleDraft || Boolean(busy)}><Save size={16} />保存</button>
            <button className="secondary icon-only" title="复制规则" onClick={copyRule}><Copy size={16} /></button>
            <button className="danger icon-only" title="删除规则" onClick={() => void deleteCurrentRule()} disabled={!selectedRuleId}><Trash2 size={16} /></button>
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="preview-head">
            <div>
              <div className="panel-title"><CheckCircle2 size={18} />数据预览</div>
              <div className="subtle">共 {rows.length} 行，约 {groupsCount} 个出库单，错误 {errorCount}，警告 {warningCount}</div>
            </div>
            <div className="button-row compact">
              <button className="secondary" onClick={addRow}><Plus size={16} />新增行</button>
              <button className="secondary" onClick={() => void exportRows()} disabled={!rows.length}><Download size={16} />导出</button>
              <button onClick={() => void submitRows()} disabled={!rows.length || Boolean(busy)}><Send size={16} />提交下单</button>
            </div>
          </div>

          <div className="table-shell" ref={parentRef}>
            <div className="data-table" style={{ height: `${virtualizer.getTotalSize() + 44}px` }}>
              <div className="table-row table-header">
                <div className="row-index">#</div>
                {editableFields.map((field) => <div key={field}>{ORDER_FIELD_LABELS[field]}</div>)}
                <div>操作</div>
              </div>
              {rows.length === 0 && (
                <div className="empty-state">
                  <FileSpreadsheet size={42} />
                  <strong>等待解析数据</strong>
                  <span>上传文件后选择规则，点击试解析即可进入预览编辑。</span>
                </div>
              )}
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <div
                    key={row.id}
                    className="table-row"
                    style={{ transform: `translateY(${virtualRow.start + 44}px)` }}
                  >
                    <div className="row-index">{row.rowNumber}</div>
                    {editableFields.map((field, fieldIndex) => (
                      <input
                        key={field}
                        data-row-index={virtualRow.index}
                        data-field-index={fieldIndex}
                        className={isIssueFor(issues, row.id, field) ? "cell-error" : ""}
                        value={String(row[field] ?? "")}
                        onChange={(event) => updateCell(row.id, field, event.target.value)}
                        onKeyDown={(event) => handleCellKeyDown(event, virtualRow.index, fieldIndex)}
                      />
                    ))}
                    <button className="danger icon-only" title="删除行" onClick={() => deleteRow(row.id)}><Trash2 size={15} /></button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="issue-panel">
            <div className="panel-title small"><AlertCircle size={17} />全量校验结果</div>
            {issues.length === 0 ? (
              <div className="ok-line"><CheckCircle2 size={16} />暂无错误</div>
            ) : (
              <div className="issue-list">
                {issues.slice(0, 80).map((issue) => (
                  <div key={issue.id} className={`issue ${issue.severity}`}>
                    <span>{issue.severity === "error" ? "错误" : "警告"}</span>
                    第 {issue.rowNumber || "-"} 行 {issue.field ? `｜${issue.field}` : ""}：{issue.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="panel history-panel">
        <div className="preview-head">
          <div>
            <div className="panel-title"><Database size={18} />已导入运单</div>
            <div className="subtle">共 {history.total} 条历史记录，支持外部编码、收件人、门店搜索</div>
          </div>
          <div className="history-tools">
            <div className="search-box">
              <Search size={16} />
              <input
                value={historyFilters.query}
                onChange={(event) => setHistoryFilters((current) => ({ ...current, query: event.target.value, page: 1 }))}
                placeholder="外部编码 / 收件人 / 门店"
              />
            </div>
            <input
              className="date-input"
              type="date"
              value={historyFilters.from}
              onChange={(event) => setHistoryFilters((current) => ({ ...current, from: event.target.value, page: 1 }))}
              aria-label="开始提交时间"
            />
            <input
              className="date-input"
              type="date"
              value={historyFilters.to}
              onChange={(event) => setHistoryFilters((current) => ({ ...current, to: event.target.value, page: 1 }))}
              aria-label="结束提交时间"
            />
            <button className="secondary" onClick={() => void loadHistory()}><Search size={16} />查询</button>
          </div>
        </div>
        <div className="history-grid">
          {history.items.length === 0 ? (
            <div className="empty-history">暂无历史数据</div>
          ) : (
            history.items.map((order) => (
              <div className="history-card" key={`${order.id}_${order.submittedAt}`}>
                <strong>{order.externalCode || order.storeName || order.id}</strong>
                <span>{order.storeName || order.recipientName || "未填写收货信息"}</span>
                <span>{order.skuLines.length} 个 SKU · {order.submittedAt?.slice(0, 19).replace("T", " ")}</span>
              </div>
            ))
          )}
        </div>
        <div className="pager">
          <span>第 {historyFilters.page} / {historyTotalPages} 页</span>
          <div className="button-row compact">
            <button
              className="secondary"
              disabled={historyFilters.page <= 1}
              onClick={() => setHistoryFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))}
            >
              上一页
            </button>
            <button
              className="secondary"
              disabled={historyFilters.page >= historyTotalPages}
              onClick={() => setHistoryFilters((current) => ({ ...current, page: Math.min(historyTotalPages, current.page + 1) }))}
            >
              下一页
            </button>
          </div>
        </div>
      </section>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </main>
  );
}
