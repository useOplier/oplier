"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "./Wordmark";
import { NotifyMainnetCta } from "./NotifyMainnetCta";
import { useScrollPastThreshold } from "@/hooks/useScrollPastThreshold";
import { cn } from "@/lib/utils";

export function HeroAndNav() {
  const heroRef = useRef<HTMLElement | null>(null);
  const showFloatingNav = useScrollPastThreshold(heroRef, 0.7);

  return (
    <>
      <FloatingNav visible={showFloatingNav} />

      <section
        ref={heroRef}
        className="relative overflow-hidden border-b border-slate-line bg-paper"
      >
        <div className="flex flex-col-reverse items-center gap-10 px-5 py-10 sm:gap-14 sm:px-8 sm:py-16 md:h-svh md:min-h-[640px] md:flex-row md:items-stretch md:gap-0 md:p-0">
          {/* Full-bleed on desktop: fills the entire left half top to bottom
              with object-cover, no padding, no aspect-ratio cap. Stacks above
              the wordmark/CTA on mobile inside a contained aspect box instead
              of shrinking the desktop split. */}
          <div className="w-full max-w-sm md:order-1 md:h-full md:w-1/2 md:max-w-none">
            <div className="relative mx-auto aspect-[4/5] w-full max-w-[420px] overflow-hidden rounded-lg md:mx-0 md:aspect-auto md:h-full md:w-full md:max-w-none md:rounded-none">
              <Image
                src="/hero.webp"
                alt="Oplier, real-world assets managed by conversation"
                fill
                priority
                sizes="(min-width: 768px) 50vw, 90vw"
                className="object-cover"
              />
            </div>
          </div>

          <div className="flex w-full flex-col items-center gap-7 text-center md:order-2 md:h-full md:w-1/2 md:items-start md:justify-center md:gap-9 md:px-14 md:text-left lg:px-20 xl:px-24">
            <Wordmark height={48} className="md:h-16" />
            <h1 className="max-w-md text-3xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-4xl md:text-[2.75rem]">
              A smarter way to manage real-world assets.
            </h1>
            <Button size="lg" asChild>
              <Link href="/app/home">Launch App</Link>
            </Button>
            <NotifyMainnetCta />
          </div>
        </div>
      </section>
    </>
  );
}

function FloatingNav({ visible }: { visible: boolean }) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 top-4 z-40 flex justify-center px-4 transition-all duration-300",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"
      )}
      aria-hidden={!visible}
    >
      <nav className="flex w-full max-w-xl items-center justify-between gap-4 rounded-full border border-slate-line bg-white/90 px-5 py-3 shadow-float backdrop-blur">
        <Wordmark height={24} />
        <div className="hidden items-center gap-6 text-sm font-medium text-ink sm:flex">
          <a href="#product" className="text-slate transition-colors hover:text-ink">
            Product
          </a>
          <a href="#how-it-works" className="text-slate transition-colors hover:text-ink">
            How It Works
          </a>
          <Link href="/docs" className="text-slate transition-colors hover:text-ink">
            Docs
          </Link>
        </div>
        <Button size="sm" asChild>
          <Link href="/app/home">Launch App</Link>
        </Button>
      </nav>
    </div>
  );
}
