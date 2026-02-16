import { createBrowserClient } from "@supabase/ssr";

const cookieOptions = {
  // Session cookie: cleared when browser is closed.
  lifetime: 0,
};

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions,
    }
  );
}
