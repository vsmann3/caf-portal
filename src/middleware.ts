import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PROTECTED_PREFIXES = ["/dashboard", "/caf", "/customers", "/admin", "/profile"];

/**
 * Edge middleware: cheap signature check for page protection.
 * The database-backed session check (isActive, role, tenancy) happens in
 * server components / API routes via getSession().
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const token = request.cookies.get("caf_session")?.value;
  if (token) {
    try {
      const secret = process.env.AUTH_SECRET;
      if (secret) {
        await jwtVerify(token, new TextEncoder().encode(secret));
        // Already logged in? Keep /login out of the way.
        if (pathname === "/login") {
          return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.next();
      }
    } catch {
      // fall through to login redirect
    }
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
