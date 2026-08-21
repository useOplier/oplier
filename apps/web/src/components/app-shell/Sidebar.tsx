"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/landing/Wordmark";
import { navItems, settingsItem } from "./nav-items";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-line bg-white/40 md:flex">
      <div className="px-6 py-6">
        <Link href="/">
          <Wordmark height={26} />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/[0.05] hover:text-ink"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 pb-6">
        <Link
          href={settingsItem.href}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
            pathname === settingsItem.href
              ? "bg-ink text-paper"
              : "text-ink/70 hover:bg-ink/[0.05] hover:text-ink"
          )}
        >
          <settingsItem.icon className="h-4 w-4" />
          {settingsItem.label}
        </Link>
      </div>
    </aside>
  );
}
