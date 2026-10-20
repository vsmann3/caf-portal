import { NextResponse, type NextRequest } from "next/server";
import { requireRole, jsonError } from "@/lib/guard";
import cities from "@/data/india-cities.json";

export async function GET(request: NextRequest) {
  const auth = await requireRole([
    "SUPER_ADMIN",
    "COMPANY_ADMIN",
    "FRANCHISE_USER",
  ]);
  if (auth instanceof NextResponse) return auth;
  const query = request.nextUrl.searchParams;
  const pin = query.get("pin");
  if (pin !== null) {
    if (!/^[1-9]\d{5}$/.test(pin))
      return jsonError(400, "Enter a valid 6-digit PIN");
    try {
      const response = await fetch(
        `https://api.postalpincode.in/pincode/${pin}`,
        { signal: AbortSignal.timeout(6000), next: { revalidate: 86400 } },
      );
      if (!response.ok) throw new Error("Postal lookup unavailable");
      const data = await response.json();
      const offices = data?.[0]?.PostOffice;
      if (!Array.isArray(offices) || !offices.length)
        return jsonError(
          404,
          "PIN not found. Select the state and city manually.",
        );
      const states = Object.keys(cities);
      const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
      const aliases: Record<string, string> = {
        orissa: "Odisha",
        pondicherry: "Puducherry",
        nctofdelhi: "Delhi",
        delhi: "Delhi",
      };
      const locations = offices
        .slice(0, 200)
        .flatMap((office: Record<string, unknown>) => {
          if (
            typeof office.State !== "string" ||
            typeof office.Name !== "string"
          )
            return [];
          const state =
            states.find(
              (s) => normalise(s) === normalise(office.State as string),
            ) ?? aliases[normalise(office.State)];
          if (!state) return [];
          const locality = office.Name.replace(/\s+(B\.O|S\.O|H\.O)$/i, "");
          const list = (cities as Record<string, string[]>)[state] ?? [];
          const block = typeof office.Block === "string" ? office.Block : "";
          const city =
            list.find((c) => normalise(c) === normalise(locality)) ??
            list.find((c) => block && normalise(c) === normalise(block)) ??
            "";
          return [
            {
              state,
              city,
              locality,
              district:
                typeof office.District === "string" ? office.District : "",
            },
          ];
        });
      if (!locations.length)
        return jsonError(
          502,
          "Postal results could not be matched. Select the state and city manually.",
        );
      return NextResponse.json({ locations });
    } catch {
      return jsonError(
        502,
        "PIN lookup unavailable. Select the state and city manually.",
      );
    }
  }
  const state = query.get("state");
  if (state)
    return NextResponse.json({
      cities: (cities as Record<string, string[]>)[state] ?? [],
    });
  return NextResponse.json({ states: Object.keys(cities) });
}
