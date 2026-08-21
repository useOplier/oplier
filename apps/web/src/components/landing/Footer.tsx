import Link from "next/link";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className="bg-paper py-12">
      <div className="shell flex flex-col items-center gap-6 border-t border-slate-line pt-10 sm:flex-row sm:items-center sm:justify-between">
        <Wordmark height={24} />
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate">
          <Link href="/docs" className="transition-colors hover:text-ink">
            Docs
          </Link>
          <a
            href="https://x.com/useoplier"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            X (formerly Twitter)
          </a>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-ink"
          >
            GitHub
          </a>
        </div>
      </div>
      <div className="shell mt-6 flex flex-col items-center justify-between gap-3 text-xs text-slate/70 sm:flex-row">
        <p>© {new Date().getFullYear()} Oplier. Not investment advice.</p>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="transition-colors hover:text-ink">
            Privacy Policy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-ink">
            Terms of Service
          </Link>
        </div>
      </div>
    </footer>
  );
}
