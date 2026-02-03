import { Suspense } from "react";
import LoginClient from "./LoginClient";

export const metadata = {
  title: "Login",
};

export const viewport = {
  themeColor: "#0f172a",
};

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
      <LoginClient />
    </Suspense>
  );
}
