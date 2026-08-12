"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { heartbeatDeviceSession } from "@/lib/db/deviceSessions";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const SIDEBAR_KEY = "thebinder:ui:sidebar-collapsed:v1";
const LEGACY_SIDEBAR_KEY = "card-ledger:ui:sidebar-collapsed:v1";

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 20V10" />
      <path d="M12 20V4" />
      <path d="M20 20v-6" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function IconReceipt() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[21px] w-[21px] block"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <g transform="translate(2 2) scale(0.83)">
        <path d="M6 2h12v20l-2-1-2 1-2-1-2 1-2-1-2 1V2z" />
        <path d="M9 7h6" />
        <path d="M9 11h6" />
        <path d="M9 15h6" />
      </g>
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z" />
      <path d="M12 10a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 21h16" />
    </svg>
  );
}
function IconDatabase() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </svg>
  );
}
function IconHeart() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.8 5.6a5 5 0 00-7.1 0L12 7.3l-1.7-1.7a5 5 0 10-7.1 7.1l1.7 1.7L12 21l7.1-6.6 1.7-1.7a5 5 0 000-7.1z" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 12l-8 8-10-10V2h8l10 10z" />
      <circle cx="7" cy="7" r="2" />
    </svg>
  );
}
function IconUser() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function IconDots() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// Phase 2A.4: top-right mobile menu trigger (hamburger), replacing the old
// visible "Sign out" text button. Same viewBox/stroke style as the other
// line icons above.
function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 block" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <IconChart /> },
  { href: "/cards", label: "Binder", icon: <IconGrid /> },
  { href: "/cards/wishlist", label: "Wishlist", icon: <IconHeart /> },
  { href: "/cards/for-sale", label: "For Sale", icon: <IconTag /> },
  { href: "/cards/sold", label: "Sold History", icon: <IconReceipt /> },
  { href: "/players", label: "Players", icon: <IconUser /> },
  { href: "/catalog", label: "Catalog", icon: <IconSearch /> },
];

// Phase 2A: mobile's bottom nav shows a reduced 5-slot subset of the same
// destinations instead of the full NAV list above -- desktop's sidebar
// keeps rendering all of NAV, unchanged. Dashboard/Binder/Players are
// pulled from NAV by href (not redefined) so there's still a single source
// of truth for those routes' label/icon.
//
// Phase 2A.4: the mobile bottom nav is now Dashboard / Binder / Add /
// Search / Players. Search intentionally does NOT reuse NAV's "Catalog"
// entry verbatim -- it's the same route (/catalog, unrenamed per this
// phase's scope) and the same icon (IconSearch, already exactly a
// magnifying glass), but a mobile-only label override, since desktop's
// sidebar keeps showing "Catalog" for that same link unchanged.
const MOBILE_DASHBOARD_ITEM = NAV.find((item) => item.href === "/dashboard")!;
const MOBILE_BINDER_ITEM = NAV.find((item) => item.href === "/cards")!;
const MOBILE_PLAYERS_ITEM = NAV.find((item) => item.href === "/players")!;
const MOBILE_SEARCH_ITEM: NavItem = { href: "/catalog", label: "Search", icon: <IconSearch /> };

// Phase 2A.4: destinations that no longer have a permanent mobile nav slot
// (and aren't Players, now primary) live in the top-right header menu,
// grouped by section -- moved from the old bottom-nav "More" sheet, same
// content/hrefs/behaviors, just relocated. (Desktop's own inline "Actions"
// dropdown in the sidebar below is unrelated and unchanged -- it still only
// shows Account/Help/Backup/Export CSV.)
type MoreLink = { href: string; label: string; icon: React.ReactNode };
const MORE_COLLECTION_LINKS: MoreLink[] = [
  { href: "/cards/wishlist", label: "Wishlist", icon: <IconHeart /> },
  { href: "/cards/for-sale", label: "For Sale", icon: <IconTag /> },
  { href: "/cards/sold", label: "Sold History", icon: <IconReceipt /> },
  { href: "/cards/locations", label: "Locations", icon: <IconMapPin /> },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/cards") {
    if (pathname === "/cards") return true;
    if (pathname.startsWith("/cards/")) {
      return (
        !pathname.startsWith("/cards/new") &&
        !pathname.startsWith("/cards/sold") &&
        !pathname.startsWith("/cards/locations") &&
        !pathname.startsWith("/cards/wishlist") &&
        !pathname.startsWith("/cards/for-sale") &&
        !pathname.startsWith("/cards/backup")
      );
    }
    return false;
  }
  return pathname === href || pathname.startsWith(href + "/");
}

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="relative group">
      {children}
      <div
        className="
          pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2
          whitespace-nowrap rounded-md border border-zinc-800 bg-[var(--brand-primary)] px-2 py-1 text-xs text-white
          opacity-0 shadow-sm transition group-hover:opacity-100
        "
      >
        {text}
        <div
          className="
            absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2
            h-2 w-2 rotate-45 bg-[var(--brand-primary)]
            border-l border-b border-zinc-800
          "
        />
      </div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  collapsed: boolean;
  active: boolean;
}) {
  const link = (
    <Link
      href={href}
      className={
        "group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition " +
        (active
          ? "bg-[var(--brand-primary)] text-white"
          : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900")
      }
    >
      <span
        className={
          "flex h-9 w-9 items-center justify-center rounded-md shrink-0 " +
          (active ? "bg-white/10" : "bg-zinc-100 group-hover:bg-white")
        }
      >
        {icon}
      </span>

      {!collapsed ? <span className="font-medium whitespace-nowrap">{label}</span> : null}
    </Link>
  );

  if (!collapsed) return link;
  return <Tooltip text={label}>{link}</Tooltip>;
}

// Phase 2A.3 (real-device correction): the touch target (this Link, full
// flex-1 slot width) and the VISUAL active/hover pill (the inner span) are
// separate elements. Previously the colored background was painted
// directly on the full-width Link, so its only clearance from the screen
// edge was whatever padding existed on <nav>/its wrapper -- a single,
// global safety margin. Giving the pill its own `p-1`-driven inset here
// means Dashboard (first slot) and the last slot (Players, as of Phase
// 2A.4) get a second, LOCAL margin that doesn't depend on getting one outer
// padding value exactly right, without shrinking the tappable area (the
// outer Link is still the full slot).
//
// Phase 2A.5 (real-device correction): that local margin was still only
// the Link's own `p-1` (4px), and real-device testing showed Dashboard's
// and Players' active pills still visibly touching the screen edge. The
// pill itself now gets an ADDITIONAL local inset via `self-stretch` +
// `mx-1.5` instead of `w-full` -- `self-stretch` (unlike `w-full`) lets the
// flex algorithm correctly subtract the span's own margin from its
// available cross-size, so it doesn't overflow the Link's padded box. This
// only widens the LOCAL margin every tab already had; it doesn't touch
// <nav>'s or the wrapper's outer padding, and applies identically to every
// tab (Dashboard/Binder/Search/Players) since they all render through this
// one component -- no special-casing either edge tab. Confirmed on a real
// device to fix the edge-clipping.
//
// Phase 2A.6 (real-device correction): that same fix left too little width
// for "Dashboard" at 320px, truncating to "Dashbo...". Traced the full
// cascade at 320px: nav's 12px pad -> row's flex-1 split (~56px/tab) ->
// this Link's p-1 (8px) -> the pill's mx-1.5 (12px) -> the pill's own px-1
// (8px) left only ~28px for the label text, well under what "Dashboard"
// needs at 9px.
//
// Phase 2A.7 (real-device correction): 2A.6's fix included trimming
// mx-1.5 -> mx-1 on this pill, which was a mistake -- mx-1.5 is the exact
// margin real-device testing confirmed fixes the Dashboard/Players corner
// clipping, and it must not be weakened again just for label width. mx-1.5
// is restored here. The width recovery for "Dashboard" instead comes from
// two places that don't touch pill geometry at all: the pill's own
// internal px-1 stays removed (pure internal breathing room, zero edge-
// safety relevance, confirmed risk-free in 2A.6), and the tab row's gap-1
// is reduced to gap-0.5 (see below) -- recovering width row-wide instead
// of from the proven-correct pill inset. Net available label width at
// 320px with this combination (~37.6px) is essentially the same as 2A.6's
// mx-1/gap-1 combination (~38px) -- confirmed by explicit arithmetic, not
// assumed -- so text-[8px] stays; there's no width basis to attempt
// text-[9px] here, and guessing wasn't an option.
function MobileNavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex flex-1 basis-0 min-w-0 flex-col items-center justify-center p-1 text-[8px] transition touch-manipulation"
    >
      <span
        className={
          "flex min-w-0 flex-col items-center justify-center gap-0.5 self-stretch overflow-hidden rounded-md mx-1.5 py-1 transition " +
          (active
            ? "text-white bg-[var(--brand-primary)]"
            : "text-zinc-600 hover:text-[var(--brand-primary)] hover:bg-zinc-100")
        }
      >
        <span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        <span className="w-full truncate text-center font-medium leading-none">
          {label.replace(" ", " ")}
        </span>
      </span>
    </Link>
  );
}

function MoreSectionHeader({ title }: { title: string }) {
  return (
    <div className="px-1 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 first:pt-0">
      {title}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthScreen = pathname.startsWith("/login") || pathname.startsWith("/signup");
  const isMarketing =
    pathname === "/" ||
    pathname === "/demo" ||
    pathname === "/help" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/contact" ||
    pathname === "/pricing" ||
    pathname === "/about" ||
    pathname === "/changelog" ||
    pathname === "/status";

  const [collapsed, setCollapsed] = useState(false);
  const [hasLoadedPref, setHasLoadedPref] = useState(false);
  const [sidebarEdgeLeft, setSidebarEdgeLeft] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string>("");
  const sidebarRef = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLDivElement | null>(null);
  // Phase 2A.4: wraps the top-right hamburger button AND its dropdown (the
  // relocated former mobile "More" sheet content) -- replaces the old
  // mobileMoreRef, which wrapped only the portaled bottom sheet. No portal
  // needed here (see the menu's own JSX below): nothing between the header
  // and <body> sets overflow-hidden, so a plain relative/absolute dropdown,
  // matching desktop's existing Actions-dropdown pattern below, renders
  // correctly without one.
  const headerMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw === "true") setCollapsed(true);
      if (raw === "false") setCollapsed(false);
      if (raw === null) {
        const legacy = localStorage.getItem(LEGACY_SIDEBAR_KEY);
        if (legacy === "true") setCollapsed(true);
        if (legacy === "false") setCollapsed(false);
        if (legacy !== null) {
          localStorage.setItem(SIDEBAR_KEY, legacy);
          localStorage.removeItem(LEGACY_SIDEBAR_KEY);
        }
      }
    } catch {
      // ignore
    } finally {
      setHasLoadedPref(true);
    }
  }, []);

  useEffect(() => {
    if (isAuthScreen || isMarketing) return;

    let stopped = false;

    const runHeartbeat = async () => {
      if (stopped) return;
      try {
        await heartbeatDeviceSession();
      } catch {
        // Ignore heartbeat errors; account page can still load without sessions list.
      }
    };

    void runHeartbeat();

    const interval = window.setInterval(() => {
      void runHeartbeat();
    }, 5 * 60 * 1000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void runHeartbeat();
      }
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isAuthScreen, isMarketing]);

  useEffect(() => {
    if (!hasLoadedPref) return;
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "true" : "false");
    } catch {
      // ignore
    }
  }, [collapsed, hasLoadedPref]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!active) return;
        setUserEmail(data?.user?.email ?? "");
      } catch {
        if (active) setUserEmail("");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;

    const updateLeft = () => {
      const rect = el.getBoundingClientRect();
      const nextLeft = rect.left + rect.width;
      setSidebarEdgeLeft((prev) => (prev === nextLeft ? prev : nextLeft));
    };

    updateLeft();

    const observer = new ResizeObserver(updateLeft);
    observer.observe(el);

    window.addEventListener("resize", updateLeft);
    window.addEventListener("scroll", updateLeft, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateLeft);
      window.removeEventListener("scroll", updateLeft, true);
    };
  }, [collapsed]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (moreRef.current?.contains(target)) return;
      if (headerMenuRef.current?.contains(target)) return;
      setMoreOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  
  const activeMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of NAV) map.set(item.href, isActivePath(pathname, item.href));
    return map;
  }, [pathname]);

  return (
    <div
      className="min-h-screen sm:flex"
      style={
        {
          "--sidebar-width": collapsed ? "4rem" : "16rem",
        } as CSSProperties
      }
    >
      {!isAuthScreen && !isMarketing ? (
        <aside
          ref={sidebarRef}
          className={
            "sticky top-0 hidden sm:flex sm:flex-col sm:border-r sm:bg-white transition-all h-screen " +
            (collapsed ? "sm:w-16" : "sm:w-64")
          }
        >
        {/* Brand row removed to keep sidebar clean */}

          {/* ✅ MID-SIDEBAR COLLAPSE BUTTON */}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="
              fixed top-1/2 left-0 z-50 -translate-y-1/2 -translate-x-1/2
              inline-flex h-9 w-9 items-center justify-center
              rounded-full border bg-white text-zinc-700 shadow-sm
              hover:bg-zinc-50
            "
            style={{ left: sidebarEdgeLeft ? `${sidebarEdgeLeft}px` : "var(--sidebar-width)" }}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
          </button>

          {/* Nav */}
          <nav className="flex-1 p-2 overflow-y-auto">
            {!collapsed ? (
              <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Binder
              </div>
            ) : null}

            <div className="space-y-1">
              {NAV.map((item) => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  collapsed={collapsed}
                  active={!!activeMap.get(item.href)}
                />
              ))}
            </div>

            {pathname === "/cards" ? (
              <div className="mt-6 border-t pt-3">
                {!collapsed ? (
                  <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Actions
                  </div>
                ) : null}

                <div ref={moreRef} className="relative">
                  {(() => {
                    const button = (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMoreOpen((v) => !v);
                        }}
                        className={
                          "group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition " +
                          (collapsed ? "-ml-0.5 w-full " : "w-full ") +
                          "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                        }
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 group-hover:bg-white">
                          <IconDots />
                        </span>
                        {!collapsed ? <span className="font-medium">More</span> : null}
                      </button>
                    );

                    if (!collapsed) return button;
                    return <Tooltip text="More">{button}</Tooltip>;
                  })()}

                  {moreOpen ? (
                    <div
                      className="absolute left-2 top-full z-50 mt-2 w-44 overflow-hidden rounded-md border bg-white shadow-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        href="/account"
                        onClick={() => setMoreOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <span className="text-xs">👤</span>
                        Account
                      </Link>
                      <Link
                        href="/help"
                        onClick={() => setMoreOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <span className="text-xs">❓</span>
                        Help
                      </Link>
                      <Link
                        href="/cards/backup"
                        onClick={() => setMoreOpen(false)}
                        className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <IconDatabase />
                        Backup
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setMoreOpen(false);
                          window.dispatchEvent(new CustomEvent("cards:export"));
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <IconDownload />
                        Export CSV
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!collapsed ? (
              <div className="mt-6 border-t pt-4 px-2">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Quick Tip
                </div>
                <div className="text-xs text-zinc-600 leading-relaxed">
                  Add a <span className="font-medium">Location</span> to cards so you can filter by
                  Binder / Box / Safe.
                </div>
              </div>
            ) : null}
          </nav>

          <div className="border-t p-3 shrink-0">
            {!collapsed ? (
              <div className="space-y-2">
                {userEmail ? (
                  <div className="text-[11px] text-zinc-500">
                    You’re signed in as <span className="font-medium text-zinc-700">{userEmail}</span>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={async () => {
                    const supabase = createClient();
                    await supabase.auth.signOut();
                    router.replace("/login?signed_out=1");
                    router.refresh();
                  }}
                  className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  router.replace("/login?signed_out=1");
                  router.refresh();
                }}
                className="mx-auto flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 bg-white text-[10px] text-zinc-700 hover:bg-zinc-50"
                title="Sign out"
                aria-label="Sign out"
              >
                ⎋
              </button>
            )}
          </div>
        </aside>
      ) : null}

      {/* Main */}
      <main className="flex-1">
        {/* Top bar */}
        {isAuthScreen ? (
          <div className="hidden sm:block border-b bg-[var(--brand-primary)] text-white">
            <div className="flex items-center justify-center px-4 py-2 gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--brand-primary)] text-white overflow-hidden ring-1 ring-white/15">
                <img src="/icon.png" alt="TheBinder" className="h-full w-full object-cover" />
              </div>
              <div className="text-xl font-semibold tracking-tight font-display">TheBinder</div>
            </div>

            <div className="px-4 pb-1" aria-hidden="true" />
          </div>
        ) : (
          <div className="sm:hidden border-b bg-[var(--brand-primary)] text-white">
            <div className="flex items-center justify-between px-4 py-2 gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-primary)] text-white overflow-hidden ring-1 ring-white/15">
                  <img src="/icon.png" alt="TheBinder" className="h-full w-full object-cover" />
                </div>
                <div className="text-sm font-semibold tracking-tight font-display">TheBinder</div>
              </div>

              {/* Phase 2A.4: replaces the old visible "Sign out" text button.
                  Same relative-wrapper + absolute-dropdown pattern as
                  desktop's own Actions dropdown in the sidebar above (no
                  portal/measured-height needed -- see headerMenuRef's
                  comment). Menu contents are the same destinations that used
                  to live in the bottom-nav More sheet (now removed, see the
                  bottom nav below), plus Sign Out, which didn't have a home
                  in that sheet before since it was already visible here. */}
              <div ref={headerMenuRef} className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMoreOpen((v) => !v);
                  }}
                  // touchstart/pointerdown only stop propagation (so the
                  // outside-click listener can't fire for this same tap) --
                  // they must NOT also toggle moreOpen here. A single tap on
                  // a touch device fires both touchstart and a synthesized
                  // click; toggling in both meant every tap flipped the
                  // state twice, so taps 1/3/5... and 2/4/6... landed on
                  // different net results instead of a clean open/close
                  // alternation. onClick is now the single place that
                  // toggles moreOpen.
                  onTouchStart={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label="Open menu"
                  className="rounded-md border border-white/20 bg-white/10 p-2 text-white"
                >
                  <IconMenu />
                </button>

                {moreOpen ? (
                  <div
                    className="absolute right-0 top-full z-[1001] mt-2 max-h-[80dvh] w-64 overflow-y-auto rounded-md border bg-white text-left text-zinc-900 shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="p-3">
                      {userEmail ? (
                        <div className="mb-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                          You’re signed in as{" "}
                          <span className="font-medium text-zinc-800">{userEmail}</span>
                        </div>
                      ) : null}

                      <MoreSectionHeader title="Collection" />
                      <div className="space-y-1">
                        {MORE_COLLECTION_LINKS.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMoreOpen(false)}
                            className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                          >
                            {item.icon}
                            {item.label}
                          </Link>
                        ))}
                      </div>

                      <MoreSectionHeader title="Account" />
                      <div className="space-y-1">
                        <Link
                          href="/account"
                          onClick={() => setMoreOpen(false)}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        >
                          <span className="text-xs">👤</span>
                          Account
                        </Link>
                        <Link
                          href="/cards/backup"
                          onClick={() => setMoreOpen(false)}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        >
                          <IconDatabase />
                          Backup
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setMoreOpen(false);
                            window.dispatchEvent(new CustomEvent("cards:export"));
                          }}
                          className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                        >
                          <IconDownload />
                          Export CSV
                        </button>
                        <Link
                          href="/help"
                          onClick={() => setMoreOpen(false)}
                          className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                        >
                          <span className="text-xs">❓</span>
                          Help
                        </Link>
                      </div>

                      {/* Visually separated final action -- easy to find,
                          not made to dominate the menu. */}
                      <div className="mt-3 border-t pt-3">
                        <button
                          type="button"
                          onClick={async () => {
                            setMoreOpen(false);
                            const supabase = createClient();
                            await supabase.auth.signOut();
                            router.replace("/login?signed_out=1");
                            router.refresh();
                          }}
                          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {/* Content container. Mobile bottom padding is base clearance PLUS
            env(safe-area-inset-bottom) on top, so content never sits behind
            the nav, the elevated button, or the safe-area/gesture region on
            any device -- additive, not reliant on the safe-area alone.
            Phase 2A.2: recalculated after lowering the Add Card circle.
            Highest point anything (nav content or the button, including its
            ring) reaches above the true viewport bottom, worst case, is now
            0.5rem (nav's own base bottom padding) + 3.5rem (h-14 row) +
            ~1.1rem (circle overlap above the row, 25% of 56px, plus a
            couple px for the ring) = ~5.1rem, before adding the device's
            safe-area inset. 5.5rem leaves a small deliberate margin over
            that at any safe-area value -- smaller than the previous 6rem,
            which was sized for the old 50%-overlap circle. */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))] sm:pb-6">
          {children}
        </div>
      </main>

      {/* Mobile bottom nav -- exactly 5 slots (Dashboard, Binder, elevated
          Add Card, Search, Players as of Phase 2A.4), tuned across several
          real-device passes (Phase 2A.1-2A.3 -- see comments below for the
          current, corrected rationale on each piece; the bar's top edge is
          intentionally straight, not rounded). The Add Card button is
          intentionally `position: absolute` and out of flex flow (not
          negative-margined), and as of Phase 2A.3 is a sibling of the tab
          row rather than nested inside it -- see its own comment below for
          why. mobileNavRef/mobileNavHeight (the old bottom-sheet's
          measured-height positioning) were removed in Phase 2A.4 along with
          that sheet -- nothing else used that measurement. */}
      {!isAuthScreen && !isMarketing ? (
        <nav
          // Phase 2A.2 (real-device correction): straight top edge restored
          // -- no rounded-t-*. Horizontal padding is base clearance (0.75rem)
          // PLUS env(safe-area-inset-left/right) -- additive, same pattern
          // as the bottom padding below. Previously the only horizontal
          // clearance came from an inner wrapper's flat `px-2` (8px) with no
          // safe-area contribution at all on this side; on a real device
          // with a ~0 safe-area-inset-left, that left the first item's
          // active background only 8px from the true screen edge, reading
          // as clipped. Moving both sides onto this single explicit calc()
          // (and dropping the wrapper's own px-2 below) makes the Dashboard
          // and Players slots symmetric by construction (Players is the
          // new fifth/rightmost slot as of Phase 2A.4, replacing More).
          // Bottom padding is unchanged from the previous pass: base
          // clearance (0.5rem) PLUS env(safe-area-inset-bottom).
          className="sm:hidden fixed bottom-0 left-0 right-0 z-[1000] w-full border-t bg-white/95 backdrop-blur overflow-visible pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] pl-[calc(0.75rem+env(safe-area-inset-left,0px))] pr-[calc(0.75rem+env(safe-area-inset-right,0px))] pointer-events-auto"
        >
        {/* Tab-row wrapper: overflow-x-hidden only. Phase 2A.3 correction --
            this previously ALSO carried overflow-y-visible, on the theory
            that declaring it explicitly would keep vertical overflow
            visible. It doesn't: per the CSS Overflow spec (and MDN's own
            note on overflow-x), when one axis is non-visible and the other
            resolves to visible, the browser computes the visible one as
            `auto` regardless of whether it was left at its default or
            explicitly authored as visible -- there's no way for an author
            to opt out of that pairing rule while keeping overflow-x hidden
            on the SAME element. So this wrapper's overflow-y was silently
            `auto` (i.e. still clipping) the entire time, which is why the
            Add Card circle kept getting cut off on a real device despite
            that "fix". The actual fix: Add Card no longer lives inside this
            wrapper at all (see below) -- overflow-x-hidden here now only
            ever needs to contain the four normal-flow tabs, which never
            escape vertically, so there's nothing left for the overflow-y
            quirk to clip. */}
        <div className="w-full max-w-full overflow-x-hidden">
          {/* Phase 2A.7: gap-1 (4px x 4 gaps = 16px total at any width)
              reduced to gap-0.5 (2px x 4 = 8px) to recover row-wide width
              for the Dashboard label without touching the pill's own
              mx-1.5 edge-safety inset (see MobileNavLink's comment). Add
              Card is unaffected: it's positioned `absolute left-1/2` on
              <nav> itself (a sibling of this whole wrapper, not a
              participant in this row's flex layout at all -- see its own
              comment below), so its horizontal center is always exactly
              50% of <nav>'s width regardless of anything in this row. */}
          <div className="relative flex h-14 w-full max-w-full items-center gap-0.5">
            <MobileNavLink
              href={MOBILE_DASHBOARD_ITEM.href}
              label={MOBILE_DASHBOARD_ITEM.label}
              icon={MOBILE_DASHBOARD_ITEM.icon}
              active={!!activeMap.get(MOBILE_DASHBOARD_ITEM.href)}
            />
            <MobileNavLink
              href={MOBILE_BINDER_ITEM.href}
              label={MOBILE_BINDER_ITEM.label}
              icon={MOBILE_BINDER_ITEM.icon}
              active={!!activeMap.get(MOBILE_BINDER_ITEM.href)}
            />

            {/* Invisible spacer keeping the five destinations evenly spaced
                -- the actual Add Card button is rendered as a sibling of
                this whole wrapper, below. */}
            <div className="flex-1 basis-0" aria-hidden="true" />

            <MobileNavLink
              href={MOBILE_SEARCH_ITEM.href}
              label={MOBILE_SEARCH_ITEM.label}
              icon={MOBILE_SEARCH_ITEM.icon}
              active={!!activeMap.get(MOBILE_SEARCH_ITEM.href)}
            />

            {/* Phase 2A.4: Players replaces the old bottom-nav More button
                (moved to the top-right header menu -- see above). Uses the
                same MobileNavLink as every other primary tab, so it
                automatically gets the same touch-target/visual-pill inset
                that previously gave Dashboard/More their edge-safety margin
                -- this fifth slot's right-edge safety is preserved by
                construction, not re-implemented. */}
            <MobileNavLink
              href={MOBILE_PLAYERS_ITEM.href}
              label={MOBILE_PLAYERS_ITEM.label}
              icon={MOBILE_PLAYERS_ITEM.icon}
              active={!!activeMap.get(MOBILE_PLAYERS_ITEM.href)}
            />

            {/* Phase 2A.5: purely decorative slot separators. Absolutely
                positioned (not real flex siblings) so they can never affect
                the five-slot flex distribution, touch targets, row height,
                or introduce overflow -- confirmed safe under the row's own
                overflow-x-hidden ancestor since inset-0 keeps every line
                strictly within the row's own box. Positioned at the row's
                1/5 and 4/5 marks (Dashboard/Binder and Search/Players),
                matching the five roughly-equal flex-1 slots without
                depending on any specific viewport width. Phase 2A.6: the
                two marks that used to sit at 2/5 and 3/5 (straddling Add
                Card) were removed entirely per real-device feedback -- the
                center area should read as open, not framed by lines on
                both sides -- rather than replaced with any other Add-area
                decoration. */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <span className="absolute left-[20%] top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-300" />
              <span className="absolute left-[80%] top-1/2 h-5 w-px -translate-x-1/2 -translate-y-1/2 bg-zinc-300" />
            </div>
          </div>
        </div>

        {/* Elevated center action. Phase 2A.3 (real-device correction): this
            Link is now a direct child of <nav> -- a SIBLING of the tab-row
            wrapper above, not nested inside it. That wrapper's
            overflow-x-hidden (see its comment above) was silently clipping
            this button's vertical overflow no matter what overflow-y value
            was declared alongside it, because that pairing is a browser
            normalization rule, not something an explicit `visible` can
            override on the same element. Moving Add Card out from under
            that ancestor entirely removes the possibility of it ever being
            clipped by the tab row's horizontal-safety overflow, regardless
            of how that wrapper's overflow is configured in the future.
            <nav> is `position: fixed`, which already establishes a valid
            containing block for this `position: absolute` child, so no
            extra `relative` wrapper is needed. z-10 gives it explicit
            stacking precedence over the (position: static) tab-row wrapper
            -- traced first: per the stacking-context rules, a positioned
            element with z-index:auto already paints after a static sibling
            regardless, so this isn't strictly load-bearing today, but makes
            that guarantee explicit rather than incidental, and comfortably
            below <nav>'s own z-[1000] since it only needs precedence over
            its own siblings inside <nav>, not the rest of the page.
            top-0 -translate-y-1/4 is unchanged from Phase 2A.2 (~25% of the
            circle above the row's top edge) -- <nav> has no padding-top, so
            its own top edge is the same reference point the row's top edge
            always was; moving this Link doesn't change its rendered
            position. */}
        <Link
          // ?mode=scan (read by /cards/new -- see that page's entryMode
          // initialization) sends this specific entry point straight into
          // the existing scan/photo workflow instead of the scan-or-manual
          // choice screen. Only this center mobile nav button changed --
          // the other in-page "Add Card" links (Binder, Sold History, the
          // empty-state grid) still point at plain /cards/new and keep
          // their current choice-screen behavior; the pathname is still
          // /cards/new either way, so isActivePath/activeMap below don't
          // need to change (query strings aren't part of usePathname()).
          href="/cards/new?mode=scan"
          aria-label="Add card"
          className="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 -translate-y-1/4 flex-col items-center justify-center touch-manipulation"
        >
          <span
            className={
              "flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 ring-white [&>svg]:h-6 [&>svg]:w-6 " +
              (pathname.startsWith("/cards/new")
                ? "bg-white text-[var(--brand-primary)]"
                : "bg-[var(--brand-primary)] text-white")
            }
          >
            <IconPlus />
          </span>
        </Link>
      </nav>
      ) : null}
    </div>
  );
}
