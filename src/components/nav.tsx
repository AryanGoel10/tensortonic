"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import clsx from "clsx";

const LINKS = [
  { href: "/prospects", label: "Prospects" },
  { href: "/review", label: "Review" },
  { href: "/ready", label: "Ready to send" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const path = usePathname();
  const params = useSearchParams();
  const keep = new URLSearchParams();
  for (const k of ["sheet", "tab"]) {
    const v = params.get(k);
    if (v) keep.set(k, v);
  }
  const qs = keep.toString() ? `?${keep}` : "";
  return (
    <nav className="flex items-center gap-1 text-sm">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={["/settings", "/activity"].includes(l.href) ? l.href : `${l.href}${qs}`}
          className={clsx("rounded-md px-2.5 py-1.5", path.startsWith(l.href) ? "bg-neutral-100 font-medium text-black" : "text-neutral-600 hover:text-black")}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
