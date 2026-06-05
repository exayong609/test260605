import { NextResponse } from "next/server";
import { deleteRule, listRules, saveRule } from "@/lib/store";
import type { ParsingRule } from "@/types";

export const runtime = "nodejs";

export async function GET() {
  const rules = await listRules();
  return NextResponse.json({ rules });
}

export async function POST(request: Request) {
  try {
    const rule = (await request.json()) as ParsingRule;
    const saved = await saveRule(rule);
    return NextResponse.json({ rule: saved });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存规则失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少规则 ID。" }, { status: 400 });
  await deleteRule(id);
  return NextResponse.json({ ok: true });
}
