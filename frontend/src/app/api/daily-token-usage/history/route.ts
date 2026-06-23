import { NextRequest, NextResponse } from "next/server";
import { getDailyTokenUsageRange } from "../../../../../../server/db/client";
import { ensureDb } from "../../_lib/ensure-db";

export async function GET(request: NextRequest) {
  try {
    await ensureDb();

    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from") ?? null;
    const to = searchParams.get("to") ?? null;

    const rows = getDailyTokenUsageRange(from, to);

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[api/daily-token-usage/history] failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
