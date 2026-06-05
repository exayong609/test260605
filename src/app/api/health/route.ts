import { NextResponse } from "next/server";
import { DEFAULT_RULES } from "@/lib/default-rules";
import { ensureSchema } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    return NextResponse.json({
      ok: true,
      service: "universal-order-importer",
      storage: process.env.DATABASE_URL ? "database" : "local-json",
      llmConfigured: Boolean(process.env.LLM_API_KEY),
      defaultRuleCount: DEFAULT_RULES.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        service: "universal-order-importer",
        error: error instanceof Error ? error.message : "Health check failed",
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
