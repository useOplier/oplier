"use client";

import { Wallet } from "lucide-react";
import { usePositions } from "@/hooks/usePositions";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatPercent, formatUsd } from "@/lib/utils";

export default function PositionsPage() {
  const positions = usePositions();

  return (
    <div className="shell max-w-2xl py-6 sm:py-10">
      <h1 className="text-lg font-semibold text-ink">Positions</h1>

      <div className="mt-6 space-y-3">
        {positions.isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}

        {positions.data?.length === 0 && (
          <EmptyState
            icon={Wallet}
            title="No positions yet"
            description="Positions open automatically the first time a UPM executes, or after a one-off transaction."
          />
        )}

        {positions.data?.map((pos) => (
          <Card key={pos.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">{pos.assetName}</p>
                  <p className="mt-0.5 text-xs text-slate">
                    {pos.systemName ? `via ${pos.systemName}` : "One-off"}
                  </p>
                </div>
                <Badge tone={pos.status === "OPEN" ? "active" : "neutral"} dot={pos.status === "OPEN"}>
                  {pos.status === "OPEN" ? "Open" : "Closed"}
                </Badge>
              </div>

              <div className="num mt-4 grid grid-cols-2 gap-y-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-slate">Quantity</p>
                  <p className="mt-0.5 text-ink">{pos.quantity}</p>
                </div>
                <div>
                  <p className="text-xs text-slate">Avg. cost</p>
                  <p className="mt-0.5 text-ink">{formatUsd(pos.avgCostUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate">Current price</p>
                  <p className="mt-0.5 text-ink">{formatUsd(pos.currentPriceUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate">ROI</p>
                  <p className={`mt-0.5 ${pos.roiPercent >= 0 ? "text-accent-dim" : "text-danger"}`}>
                    {formatPercent(pos.roiPercent, { signed: true })}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
