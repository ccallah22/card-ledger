// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // ✅ IMPORTANT: loads/refreshes user from cookies correctly
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = req.nextUrl.pathname;

  // adjust these to your routes
  const isAuthPage = path.startsWith("/login");
  const isPublic =
    path === "/" ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path.startsWith("/api") ||
    path === "/manifest.json" ||
    path === "/sw.js";

  // Everything in (app) should be protected (e.g. /cards, /cards/new, etc.)
  const isProtected = !isPublic && !isAuthPage;

  if (!user && isProtected) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/cards";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
