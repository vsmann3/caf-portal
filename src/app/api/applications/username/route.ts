import { NextResponse, type NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/guard";
import { filingFranchise, availableUsername } from "@/lib/caf-access";
import { usernameCandidates } from "@/lib/caf-fields";

export async function POST(request: NextRequest) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const body = await request.json().catch(() => null);
  if (
    !body ||
    typeof body.franchiseId !== "string" ||
    typeof body.name !== "string" ||
    typeof body.mobile !== "string"
  )
    return jsonError(400, "Name, mobile and franchise required");
  const franchise = await filingFranchise(auth, body.franchiseId);
  if (!franchise) return jsonError(404, "Franchise not found");
  const candidates = usernameCandidates(body.name, body.mobile);
  if (!candidates.length)
    return jsonError(400, "Enter a valid customer name and mobile");
  const username = await availableUsername(franchise.companyId, candidates);
  return NextResponse.json(
    {
      username,
      message: username
        ? "Available now; confirmed when submitted"
        : "A unique suffix will be assigned when submitted",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
