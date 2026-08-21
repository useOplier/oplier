"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/landing/Wordmark";
import { ConnectWalletButton } from "./ConnectWalletButton";
import { navItems, settingsItem } from "./nav-items";

const allScreens = [...navItems, settingsItem];

function currentTitle(pathname: string) {
  const match = allScreens.find((item) => pathname === item.href || pathname.startsWith(item.href + "/"));
  return match?.label ?? "Oplier";
}

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-line bg-paper/95 px-4 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3 md:hidden">
        <Link href="/">
          <Wordmark height={22} />
        </Link>
      </div>
      <h1 className="hidden text-sm font-semibold text-ink md:block">{currentTitle(pathname)}</h1>
      <div className="flex items-center gap-3">
        <Link
          href={settingsItem.href}
          className="text-slate transition-colors hover:text-ink md:hidden"
          aria-label="Settings"
        >
          <settingsItem.icon className="h-5 w-5" />
        </Link>
        <ConnectWalletButton />
      </div>
    </header>
  );
}
