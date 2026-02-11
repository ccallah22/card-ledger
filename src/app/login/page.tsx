import { Suspense } from "react";
import type { Metadata } from "next";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "TheBinder — Sign in",
  description: "Sign in to manage your collection in TheBinder.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto mt-24 max-w-sm p-6">Loading…</div>}>
      <LoginClient />
    </Suspense>
  );
}
