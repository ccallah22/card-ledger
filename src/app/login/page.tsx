import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto mt-24 max-w-sm p-6">Loading…</div>}>
      <LoginClient />
    </Suspense>
  );
}
