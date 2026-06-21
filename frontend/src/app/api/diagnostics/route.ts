import { NextResponse } from "next/server";
import { initDb, getRefreshRunState, getLatestSnapshot } from "../../../../../server/db/client";
import { buildDiagnostics } from "../../../../../server/lib/build-diagnostics";

let dbInitialized = false;

async function ensureDb(): Promise<void> {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

export async function GET() {
  try {
    await ensureDb();
    const body = buildDiagnostics(getRefreshRunState(), getLatestSnapshot());
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("[api/diagnostics] failed to build diagnostics response:", error);
    return NextResponse.json(
      { error: "Database unavailable" },
      { status: 500 },
    );
  }
}
