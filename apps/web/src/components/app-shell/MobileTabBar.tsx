"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "./nav-items";
import { cn } from "@/lib/utils";

export function MobileTabBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-line bg-white/95 backdrop-blur md:hidden">
      <div className="grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors",
                active ? "text-ink" : "text-slate"
              )}
            >
              <Icon className={cn("h-5 w-5", active && "text-accent-dim")} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
