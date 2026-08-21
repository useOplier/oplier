import { cn } from "@/lib/utils";

export function Section({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("space-y-4", className)}>{children}</section>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-semibold tracking-tight text-ink">{children}</h2>;
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-ink">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate">{children}</ul>;
}

export function OL({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate">{children}</ol>;
}

export function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="rounded-md border-l-2 border-accent bg-accent-tint/40 px-4 py-2.5 text-sm italic text-ink">
      {children}
    </blockquote>
  );
}
