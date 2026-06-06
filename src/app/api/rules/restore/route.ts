import { NextResponse } from "next/server";
import { restoreDefaultRule } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { id } = (await request.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: "缺少规则 ID。" }, { status: 400 });
    const rule = await restoreDefaultRule(id);
    return NextResponse.json({ rule });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "恢复内置规则失败。" }, { status: 400 });
  }
}
