import { NextResponse } from "next/server";
import { listOrders, saveOrders } from "@/lib/store";
import { validateRows, groupRows } from "@/lib/validation";
import { existingExternalCodes } from "@/lib/store";
import type { ParsedOrderRow } from "@/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const data = await listOrders({
    query: searchParams.get("query") || undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    page: Number(searchParams.get("page") || 1),
    pageSize: Number(searchParams.get("pageSize") || 20)
  });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { rows: ParsedOrderRow[] };
    const existingCodes = await existingExternalCodes();
    const issues = validateRows(body.rows || [], existingCodes).filter((issue) => issue.severity === "error");
    if (issues.length) {
      return NextResponse.json({ successCount: 0, failureCount: body.rows?.length || 0, issues }, { status: 400 });
    }
    const groups = groupRows(body.rows || []);
    const saved = await saveOrders(groups);
    return NextResponse.json({ successCount: saved.length, failureCount: 0, issues: [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "提交失败。" }, { status: 500 });
  }
}
