import { NextResponse } from "next/server";
import { deleteLlmProfile, getLlmProfile, listLlmProfileViews, saveLlmProfile } from "@/lib/store";
import type { LlmProfile, LlmProtocol } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const profiles = await listLlmProfileViews();
  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<LlmProfile> & { keepExistingKey?: boolean };
    if (!payload.id || !payload.name || !payload.baseUrl || !payload.model) {
      return NextResponse.json({ error: "请完整填写 Profile 名称、API URL 和模型名称。" }, { status: 400 });
    }
    const protocol = normalizeProtocol(payload.protocol);
    if (!protocol) {
      return NextResponse.json({ error: "请选择支持的接口协议。" }, { status: 400 });
    }

    const existing = await getLlmProfile(payload.id);
    const apiKey = payload.apiKey?.trim() || (payload.keepExistingKey ? existing?.apiKey : "");
    if (!apiKey) {
      return NextResponse.json({ error: "请填写 API Key。" }, { status: 400 });
    }

    const now = new Date().toISOString();
    const saved = await saveLlmProfile({
      id: payload.id,
      name: payload.name,
      protocol,
      baseUrl: payload.baseUrl,
      model: payload.model,
      apiKey,
      temperature: payload.temperature ?? 0.1,
      timeoutMs: payload.timeoutMs ?? 25000,
      enabled: payload.enabled ?? true,
      createdAt: existing?.createdAt || payload.createdAt || now,
      updatedAt: now
    });

    return NextResponse.json({
      profile: {
        id: saved.id,
        name: saved.name,
        protocol: saved.protocol,
        baseUrl: saved.baseUrl,
        model: saved.model,
        temperature: saved.temperature,
        timeoutMs: saved.timeoutMs,
        enabled: saved.enabled,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
        hasApiKey: Boolean(saved.apiKey),
        source: "stored"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存大模型 Profile 失败。" }, { status: 500 });
  }
}

function normalizeProtocol(protocol?: string): LlmProtocol | null {
  if (!protocol || protocol === "openai-compatible") return "openai-compatible";
  if (protocol === "anthropic-compatible") return "anthropic-compatible";
  if (protocol === "minimax-native") return "minimax-native";
  return null;
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少 Profile ID。" }, { status: 400 });
  await deleteLlmProfile(id);
  return NextResponse.json({ ok: true });
}
