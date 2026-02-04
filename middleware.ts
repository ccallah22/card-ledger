import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

async function supabaseProxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // IMPORTANT: this refreshes cookies if needed
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response, user };
}

export async function middleware(request: NextRequest) {
  let response: NextResponse;
  let user: unknown;
  try {
    const result = await supabaseProxy(request);
    response = result.response;
    user = result.user;
  } catch {
    // If middleware fails, don't block requests.
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;

  // ✅ Only protect app pages, not everything.
  const isProtected =
    path.startsWith("/cards") ||
    path.startsWith("/account") ||
    path.startsWith("/debug"); // optional

  const isAuthPage = path.startsWith("/login") || path.startsWith("/signup");

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (isAuthPage && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/cards";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json).*)"],
};
