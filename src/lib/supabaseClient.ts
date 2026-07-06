// Compatibility singleton for the ~17 repository files that import
// `{ supabase }` from here directly (rather than calling a factory). This
// used to construct its own separate plain @supabase/supabase-js client with
// its own localStorage-based session, independent of the cookie-synced
// session used by the login flow -- which meant repositories never saw a
// signed-in user's session ("Auth session missing!"). It now delegates to
// the one canonical browser client (@/lib/supabase/client), so repositories
// share the same authenticated, cookie-backed session as the rest of the app.
import { createClient } from "@/lib/supabase/client";

export const supabase = createClient();
