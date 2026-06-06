import { NextResponse } from "next/server";
import { parseUploadToDocument } from "@/lib/document";
import { generateRuleWithLlm } from "@/lib/llm";
import { getLlmProfile } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传文件。" }, { status: 400 });
    }
    const profileId = formData.get("profileId");
    const prompt = formData.get("prompt");
    const shouldUseProfile = typeof profileId === "string" && Boolean(profileId);
    const profile = shouldUseProfile ? await getLlmProfile(profileId as string) : undefined;
    const document = await parseUploadToDocument(file);
    const generated = await generateRuleWithLlm(document, {
      protocol: profile?.protocol,
      baseUrl: profile?.baseUrl,
      model: profile?.model,
      apiKey: profile?.apiKey,
      temperature: profile?.temperature,
      timeoutMs: profile?.timeoutMs,
      prompt: typeof prompt === "string" ? prompt : undefined,
      disableEnvFallback: !profile
    });
    return NextResponse.json({ document, ...generated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "生成规则失败。" }, { status: 500 });
  }
}
