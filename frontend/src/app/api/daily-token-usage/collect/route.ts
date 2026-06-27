import { NextResponse } from "next/server";
import { maybeCollectDailyTokenUsage } from "../../../../../../server/lib/daily-token-usage/collector";
import { ensureDb } from "../../_lib/ensure-db";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    await ensureDb();

    const result = await maybeCollectDailyTokenUsage();

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          dates: result.dates,
          upserted: result.upserted,
          skipped: result.skipped,
          errors: result.errors,
        },
        { status: 502 },
      );
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[api/daily-token-usage/collect] failed to collect daily token usage:", error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Collection failed", message },
      { status: 500 },
    );
  }
}
