import { NextResponse } from "next/server";
import { parseUploadToDocument } from "@/lib/document";
import { executeRule } from "@/lib/rule-engine";
import { existingExternalCodes } from "@/lib/store";
import type { ParsingRule, ValidationIssue } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const ruleRaw = formData.get("rule");
    const checkExisting = formData.get("checkExisting") === "true";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件。" }, { status: 400 });
    }

    const document = await parseUploadToDocument(file);
    if (!ruleRaw || typeof ruleRaw !== "string") {
      return NextResponse.json({ document });
    }

    const rule = JSON.parse(ruleRaw) as ParsingRule;
    const existingCodes = checkExisting ? await existingExternalCodes() : [];
    const result = executeRule(document, rule, existingCodes);
    const hasContent = document.stats.rowCount > 0 || document.stats.charCount > 0;
    if (hasContent && result.rows.length === 0) {
      const emptyIssue: ValidationIssue = {
        id: "parse_empty_result",
        severity: "error",
        field: "order",
        message: "当前规则没有解析出任何明细，请在规则配置中预解析并调整映射，或使用 AI 生成推荐规则。"
      };
      result.issues = [emptyIssue, ...result.issues];
    }
    return NextResponse.json({ document, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "解析失败。" }, { status: 500 });
  }
}
