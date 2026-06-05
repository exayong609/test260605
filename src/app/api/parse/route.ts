import { NextResponse } from "next/server";
import { parseUploadToDocument } from "@/lib/document";
import { executeRule } from "@/lib/rule-engine";
import { existingExternalCodes } from "@/lib/store";
import type { ParsingRule } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const ruleRaw = formData.get("rule");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件。" }, { status: 400 });
    }

    const document = await parseUploadToDocument(file);
    if (!ruleRaw || typeof ruleRaw !== "string") {
      return NextResponse.json({ document });
    }

    const rule = JSON.parse(ruleRaw) as ParsingRule;
    const existingCodes = await existingExternalCodes();
    const result = executeRule(document, rule, existingCodes);
    return NextResponse.json({ document, result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "解析失败。" }, { status: 500 });
  }
}
