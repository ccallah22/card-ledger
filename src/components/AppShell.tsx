"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const SIDEBAR_KEY = "card-ledger:ui:sidebar-collapsed:v1";

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </svg>
  );
}
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
function IconReceipt() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 2h12v20l-2-1-2 1-2-1-2 1-2-1-2 1V2z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
      <path d="M9 15h6" />
    </svg>
  );
}
function IconMapPin() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 21s7-4.5 7-11a7 7 0 10-14 0c0 6.5 7 11 7 11z" />
      <path d="M12 10a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  );
}
function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 21h16" />
    </svg>
  );
}
function IconDatabase() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </svg>
  );
}
function IconHeart() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.8 5.6a5 5 0 00-7.1 0L12 7.3l-1.7-1.7a5 5 0 10-7.1 7.1l1.7 1.7L12 21l7.1-6.6 1.7-1.7a5 5 0 000-7.1z" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 12l-8 8-10-10V2h8l10 10z" />
      <circle cx="7" cy="7" r="2" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
function IconChevronRight() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

const NAV: NavItem[] = [
  { href: "/cards", label: "Collection", icon: <IconGrid /> },
  { href: "/cards/new", label: "Add Card", icon: <IconPlus /> },
  { href: "/cards/wishlist", label: "Wishlist", icon: <IconHeart /> },
  { href: "/cards/for-sale", label: "For Sale", icon: <IconTag /> },
  { href: "/cards/backup", label: "Backup", icon: <IconDatabase /> },
  { href: "/cards/sold", label: "Sold History", icon: <IconReceipt /> },
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
          whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-white
          opacity-0 shadow-sm transition group-hover:opacity-100
        "
      >
        {text}
        <div
          className="
            absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2
            h-2 w-2 rotate-45 bg-zinc-900
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
          ? "bg-zinc-900 text-white"
          : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900")
      }
    >
      <span
        className={
          "flex h-9 w-9 items-center justify-center rounded-md " +
          (active ? "bg-white/10" : "bg-zinc-100 group-hover:bg-white")
        }
      >
        {icon}
      </span>

      {!collapsed ? <span className="font-medium">{label}</span> : null}
    </Link>
  );

  if (!collapsed) return link;
  return <Tooltip text={label}>{link}</Tooltip>;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [collapsed, setCollapsed] = useState(false);
  const [hasLoadedPref, setHasLoadedPref] = useState(false);
  const [sidebarEdgeLeft, setSidebarEdgeLeft] = useState<number | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_KEY);
      if (raw === "true") setCollapsed(true);
      if (raw === "false") setCollapsed(false);
    } catch {
      // ignore
    } finally {
      setHasLoadedPref(true);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedPref) return;
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? "true" : "false");
    } catch {
      // ignore
    }
  }, [collapsed, hasLoadedPref]);

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
      {/* Sidebar (desktop) */}
      <aside
        ref={sidebarRef}
        className={
          "relative hidden sm:flex sm:flex-col sm:border-r sm:bg-white transition-all " +
          (collapsed ? "sm:w-16" : "sm:w-64")
        }
      >
        {/* Brand row */}
        <div
          className={
            "flex items-center border-b py-4 " +
            (collapsed ? "justify-center px-0" : "justify-between px-2")
          }
        >
          <div className={"flex items-center " + (collapsed ? "" : "gap-2")}>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <span className="text-sm font-semibold">T</span>
            </div>
            {!collapsed ? (
              <div className="text-sm font-semibold tracking-tight">TheBindr</div>
            ) : null}
          </div>
        </div>

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
        <nav className="flex-1 p-2">
          {!collapsed ? (
            <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Library
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

              {(() => {
                const button = (
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent("cards:export"))}
                    className={
                      "group flex items-center gap-3 rounded-md px-2 py-2 text-sm transition " +
                      (collapsed ? "-ml-0.5 w-full " : "w-full ") +
                      "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                    }
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 group-hover:bg-white">
                      <IconDownload />
                    </span>
                    {!collapsed ? <span className="font-medium">Export CSV</span> : null}
                  </button>
                );

                if (!collapsed) return button;
                return <Tooltip text="Export CSV">{button}</Tooltip>;
              })()}
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

        {!collapsed ? (
          <div className="border-t p-3 text-xs text-zinc-500">
            Local storage • No account needed
          </div>
        ) : (
          <div className="border-t p-2 text-[10px] text-zinc-500 text-center">MVP</div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1">
        {/* Mobile top bar */}
        <div className="sm:hidden border-b bg-white">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="text-sm font-semibold">TheBindr</div>
            <Link
              href="/cards/new"
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
            >
              Add
            </Link>
          </div>

          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            {NAV.map((item) => {
              const active = !!activeMap.get(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    "rounded-full px-3 py-1 text-sm whitespace-nowrap " +
                    (active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Content container */}
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6">{children}</div>
      </main>
    </div>
  );
}
