import { NextResponse } from "next/server";
import { testLlmProfile } from "@/lib/llm";
import { getLlmProfile } from "@/lib/store";
import type { LlmProfile } from "@/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<LlmProfile> & { profileId?: string; keepExistingKey?: boolean };
    const stored = payload.profileId ? await getLlmProfile(payload.profileId) : null;
    const apiKey = payload.apiKey?.trim() || (payload.keepExistingKey ? stored?.apiKey : "");
    const profile = {
      protocol: payload.protocol || stored?.protocol,
      baseUrl: payload.baseUrl || stored?.baseUrl,
      model: payload.model || stored?.model,
      apiKey,
      temperature: payload.temperature ?? stored?.temperature,
      timeoutMs: payload.timeoutMs ?? stored?.timeoutMs
    };
    const result = await testLlmProfile(profile);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "大模型连接测试失败。" });
  }
}
