"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function WishlistSearchRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/cards/new?wishlist=1");
  }, [router]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-4 pb-10 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Wishlist Search</h1>
      <p className="text-sm text-zinc-600">Loading wishlist search…</p>
    </div>
  );
}
