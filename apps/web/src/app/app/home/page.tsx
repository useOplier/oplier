"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { usePortfolio, useInsights } from "@/hooks/usePortfolio";
import { useSystems } from "@/hooks/useSystems";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPercent, formatUsd } from "@/lib/utils";

export default function HomePage() {
  const portfolio = usePortfolio();
  const insights = useInsights();
  const systems = useSystems();

  const activeSystems = systems.data?.filter((s) => s.status === "ACTIVE") ?? [];

  return (
    <div className="shell max-w-3xl py-6 sm:py-10">
      {/* Portfolio value */}
      <section>
        <p className="text-sm text-slate">Portfolio value</p>
        {portfolio.isLoading ? (
          <Skeleton className="mt-2 h-10 w-40" />
        ) : (
          <p className="num mt-1 text-4xl font-semibold text-ink sm:text-5xl">
            {formatUsd(portfolio.data?.totalValueUsd ?? 0)}
          </p>
        )}
      </section>

      {/* AI Insights */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">AI Insights</h2>
        <div className="mt-3 space-y-3">
          {insights.isLoading && <Skeleton className="h-20 w-full rounded-lg" />}
          {insights.data?.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-line px-4 py-6 text-center text-sm text-slate">
              Nothing to flag right now. Oplier will surface relevant events here as they come up.
            </p>
          )}
          {insights.data?.map((insight) => (
            <Link
              key={insight.id}
              href="/app/chat"
              className="flex items-start justify-between gap-4 rounded-lg border border-slate-line bg-white/60 p-4 transition-colors hover:border-ink/20"
            >
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-tint">
                  <Sparkles className="h-3.5 w-3.5 text-accent-dim" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{insight.headline}</p>
                  <p className="mt-0.5 text-sm text-slate">{insight.body}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-dim">
                    Analyze <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Holdings */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">Holdings</h2>
        <Card className="mt-3">
          <CardContent className="divide-y divide-slate-line p-0">
            {portfolio.isLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-4">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            {portfolio.data?.holdings.map((h) => (
              <div key={h.assetSymbol} className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-ink">{h.assetName}</p>
                  <p className="num mt-0.5 text-xs text-slate">
                    {h.quantity} {h.assetSymbol} · {formatUsd(h.priceUsd)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="num text-sm font-medium text-ink">{formatUsd(h.valueUsd)}</p>
                  {h.roiPercent !== null && (
                    <p
                      className={`num mt-0.5 text-xs ${h.roiPercent >= 0 ? "text-accent-dim" : "text-danger"}`}
                    >
                      {formatPercent(h.roiPercent, { signed: true })}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Active systems */}
      <section className="mb-4 mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">Active systems</h2>
          <Link href="/app/systems" className="text-xs font-medium text-slate hover:text-ink">
            View all
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {systems.isLoading && <Skeleton className="h-24 w-full rounded-lg sm:col-span-2" />}
          {activeSystems.length === 0 && !systems.isLoading && (
            <p className="rounded-lg border border-dashed border-slate-line px-4 py-6 text-center text-sm text-slate sm:col-span-2">
              No active UPMs yet. Ask Oplier to create one in Chat.
            </p>
          )}
          {activeSystems.map((sys) => (
            <Card key={sys.id}>
              <CardHeader>
                <CardTitle>{sys.name}</CardTitle>
                <Badge tone="active" dot>
                  Active
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="num text-xs text-slate">
                  Max allocation {sys.maxAllocation} {sys.maxAllocationAsset}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
