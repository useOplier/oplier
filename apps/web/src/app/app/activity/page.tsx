"use client";

import { Activity as ActivityIcon, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useActivity } from "@/hooks/useActivity";
import { useSettings } from "@/hooks/useSettings";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatUsd } from "@/lib/utils";
import type { ActivityItem } from "@/lib/api/types";

const statusIcon: Record<ActivityItem["status"], React.ReactNode> = {
  SUCCESS: <CheckCircle2 className="h-4 w-4 text-accent-dim" />,
  FAILED: <XCircle className="h-4 w-4 text-danger" />,
  PENDING: <Clock className="h-4 w-4 text-slate" />,
};

export default function ActivityPage() {
  const activity = useActivity();
  const settings = useSettings();
  const timezone = settings.data?.timezone ?? "UTC";

  return (
    <div className="shell max-w-2xl py-6 sm:py-10">
      <h1 className="text-lg font-semibold text-ink">Activity</h1>

      <div className="mt-6 divide-y divide-slate-line rounded-lg border border-slate-line bg-white/60">
        {activity.isLoading &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="m-3 h-14 rounded-md" />)}

        {activity.data?.items.length === 0 && (
          <div className="p-2">
            <EmptyState
              icon={ActivityIcon}
              title="No activity yet"
              description="Executions from your UPMs and one-off transactions will show up here."
            />
          </div>
        )}

        {activity.data?.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex items-center gap-3">
              {statusIcon[item.status]}
              <div>
                <p className="text-sm font-medium text-ink">
                  {item.side === "BUY" ? "Buy" : "Sell"} {item.assetSymbol}
                </p>
                <p className="mt-0.5 text-xs text-slate">
                  {item.kind === "SYSTEM_EXECUTION" ? item.systemName : "One-off transaction"} ·{" "}
                  {formatDateTime(item.timestamp, timezone)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="num text-sm text-ink">{formatUsd(item.amountUsd)}</p>
              {item.txHash && <p className="num mt-0.5 text-xs text-slate">{item.txHash}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
