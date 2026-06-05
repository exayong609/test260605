import { inferRuleFromDocument } from "@/lib/rule-inference";
import type { IntermediateDocument, ParsingRule } from "@/types";

const RULE_SYSTEM_PROMPT = `你是物流批量下单系统的解析规则架构师。
请根据文件结构样本生成一份解析规则 JSON。注意：
1. 你生成的是规则，不是直接解析后的数据。
2. 不得依赖文件名。
3. 必须标注 assumptions，说明哪些字段映射是推测的。
4. 输出必须是 JSON，字段符合 ParsingRule：name/sourceKind/layout/sheetMode/headerRowIndex/dataStartRowIndex/stopWhenRowMatches/skipRowPatterns/groupBy/mappings/matrix/sectionSeparatorPattern/itemLinePattern/assumptions/confidence。
5. 字段名只能使用 externalCode, storeName, recipientName, recipientPhone, recipientAddress, skuCode, skuName, skuQuantity, skuSpec, remark。`;

function extractJson(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(raw);
}

export async function generateRuleWithLlm(document: IntermediateDocument): Promise<{ rule: ParsingRule; provider: "llm" | "fallback" }> {
  const fallback = inferRuleFromDocument(document);
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) return { rule: fallback, provider: "fallback" };

  const baseUrl = process.env.LLM_BASE_URL || "https://api.deepseek.com";
  const model = process.env.LLM_MODEL || "deepseek-chat";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RULE_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            file: {
              sourceKind: document.sourceKind,
              stats: document.stats,
              sample: document.sample
            },
            fallbackRuleForSchemaReference: fallback
          })
        }
      ]
    }),
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    return {
      rule: { ...fallback, assumptions: [...(fallback.assumptions || []), `大模型调用失败：HTTP ${response.status}，已使用本地推荐规则。`] },
      provider: "fallback"
    };
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return { rule: fallback, provider: "fallback" };
  const aiRule = extractJson(content) as Partial<ParsingRule>;
  const now = new Date().toISOString();

  return {
    rule: {
      ...fallback,
      ...aiRule,
      id: fallback.id,
      name: aiRule.name || fallback.name,
      sourceKind: aiRule.sourceKind || fallback.sourceKind,
      layout: aiRule.layout || fallback.layout,
      mappings: aiRule.mappings?.length ? aiRule.mappings : fallback.mappings,
      createdAt: now,
      updatedAt: now,
      aiGenerated: true,
      assumptions: aiRule.assumptions?.length ? aiRule.assumptions : fallback.assumptions,
      confidence: aiRule.confidence ?? fallback.confidence
    },
    provider: "llm"
  };
}
