import Link from "next/link";
import { Wordmark } from "@/components/landing/Wordmark";

export function ContentPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-slate-line">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/">
            <Wordmark height={22} />
          </Link>
          <Link href="/" className="text-sm font-medium text-slate transition-colors hover:text-ink">
            Back to home
          </Link>
        </div>
      </header>

      <main className="shell max-w-2xl py-14 sm:py-20">
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
        {updated && <p className="mt-3 text-sm text-slate">Last updated: {updated}</p>}
        <div className="mt-10 space-y-10">{children}</div>
      </main>
    </div>
  );
}
