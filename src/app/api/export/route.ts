import { NextResponse } from "next/server";
import type { ParsedOrderRow } from "@/types";
import { ORDER_FIELD_LABELS, ORDER_FIELDS } from "@/lib/fields";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = (await request.json()) as { rows: ParsedOrderRow[] };
  const XLSX = await import("xlsx");
  const rows = (payload.rows || []).map((row) => {
    const item: Record<string, string | number | undefined> = {};
    ORDER_FIELDS.forEach((field) => {
      item[ORDER_FIELD_LABELS[field]] = row[field] as string | number | undefined;
    });
    return item;
  });
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "预览数据");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const responseBody = new Uint8Array(buffer);

  return new NextResponse(responseBody, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-${Date.now()}.xlsx"`
    }
  });
}
