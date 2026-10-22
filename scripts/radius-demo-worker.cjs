// HTTP worker sidecar: DB/credentials remain inside CAF; never print response bodies.
const token = process.env.CAF_RADIUS_WORKER_TOKEN;
const base = process.env.CAF_DEMO_WORKER_BASE_URL || "http://app:3000";
if (!token || token.length < 32 || process.env.CAF_RADIUS_DEMO !== "1")
  throw new Error("Explicit demo worker configuration required");
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
(async () => {
  while (!stopping) {
    try {
      const r = await fetch(base + "/api/internal/radius-demo/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) console.log(`Demo worker HTTP ${r.status}; will retry`);
    } catch {
      console.log(
        "Demo worker outcome unavailable; receipt reconciliation will retry",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
})().catch(() => {
  process.exitCode = 1;
});
