import { NextResponse } from "next/server";
import { parseUploadToDocument } from "@/lib/document";
import { generateRuleWithLlm } from "@/lib/llm";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件。" }, { status: 400 });
    }
    const document = await parseUploadToDocument(file);
    const generated = await generateRuleWithLlm(document);
    return NextResponse.json({ document, ...generated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成规则失败。" }, { status: 500 });
  }
}
