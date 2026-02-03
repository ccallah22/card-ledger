"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function check() {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;

        if (!mounted) return;

        if (!session) {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          return;
        }

        setChecking(false);
      } catch (err) {
        if (!mounted) return;
        const name = (err as Error)?.name;
        if (name !== "AbortError") {
          router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        }
      }
    }

    check();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, pathname]);

  if (checking) {
    return (
      <div style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
        <div style={{ opacity: 0.75 }}>Checking login…</div>
      </div>
    );
  }

  return <>{children}</>;
}
