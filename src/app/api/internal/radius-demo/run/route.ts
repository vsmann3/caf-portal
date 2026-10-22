import { NextResponse, type NextRequest } from "next/server";
import { equalSecret, demoEnabled } from "@/lib/radius-demo/common";
import { runDemoWorker } from "@/lib/radius-demo/worker";
export const maxDuration = 30;
export async function POST(request: NextRequest) {
  const token = process.env.CAF_RADIUS_WORKER_TOKEN;
  const presented = request.headers.get("authorization") ?? "";
  if (
    !demoEnabled() ||
    !token ||
    token.length < 32 ||
    !equalSecret(presented, `Bearer ${token}`)
  )
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    return NextResponse.json(await runDemoWorker(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Demo worker unavailable" },
      { status: 503 },
    );
  }
}
