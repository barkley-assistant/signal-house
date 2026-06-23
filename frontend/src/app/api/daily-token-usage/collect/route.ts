import { NextResponse } from "next/server";
import { collectAndStoreDailyTokenUsage } from "../../../../../../server/lib/daily-token-usage/collector";

export async function POST() {
  try {
    const result = await collectAndStoreDailyTokenUsage();

    if (!result.success) {
      return NextResponse.json(
        { success: false, date: result.date, errors: result.errors },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      date: result.date,
      row: result.row,
    });
  } catch (error) {
    console.error("[api/daily-token-usage/collect] failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
