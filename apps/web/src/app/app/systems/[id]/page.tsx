"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Pause, Play, Trash2 } from "lucide-react";
import { useSystem, useSystemActions } from "@/hooks/useSystems";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";
import { useSettings } from "@/hooks/useSettings";
import { useRouter } from "next/navigation";

const statusBadge = {
  ACTIVE: { tone: "active" as const, label: "Active" },
  PAUSED: { tone: "inactive" as const, label: "Paused" },
  AUTHORIZATION_REQUIRED: { tone: "warning" as const, label: "Needs authorization" },
  HALTED: { tone: "warning" as const, label: "Halted" },
  COMPLETE: { tone: "neutral" as const, label: "Complete" },
  EXPIRED: { tone: "neutral" as const, label: "Expired" },
};

const execStatusIcon = {
  SUCCESS: <CheckCircle2 className="h-3.5 w-3.5 text-accent-dim" />,
  FAILED: <XCircle className="h-3.5 w-3.5 text-danger" />,
  PENDING: <Clock className="h-3.5 w-3.5 text-slate" />,
};

export default function SystemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const system = useSystem(id);
  const { pause, resume, remove } = useSystemActions();
  const settings = useSettings();
  const router = useRouter();
  const timezone = settings.data?.timezone ?? "UTC";

  if (system.isLoading) {
    return (
      <div className="shell max-w-2xl space-y-4 py-6 sm:py-10">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (!system.data) return null;
  const sys = system.data;
  const badge = statusBadge[sys.status];
  const canToggle = sys.status === "ACTIVE" || sys.status === "PAUSED";

  function handleDelete() {
    if (window.confirm(`Delete "${sys.name}"? This permanently revokes its permissions and can't be undone.`)) {
      remove.mutate(id, { onSuccess: () => router.push("/app/systems") });
    }
  }

  return (
    <div className="shell max-w-2xl py-6 sm:py-10">
      <Link href="/app/systems" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> Systems
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-ink">{sys.name}</h1>
          <Badge tone={badge.tone} dot={sys.status === "ACTIVE"} className="mt-2">
            {badge.label}
          </Badge>
        </div>
        <div className="flex shrink-0 gap-2">
          {canToggle && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => (sys.status === "ACTIVE" ? pause.mutate(id) : resume.mutate(id))}
            >
              {sys.status === "ACTIVE" ? (
                <>
                  <Pause className="h-3.5 w-3.5" /> Pause
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" /> Resume
                </>
              )}
            </Button>
          )}
          <Button size="sm" variant="danger" onClick={handleDelete}>
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      {/* Config */}
      <Card className="mt-6">
        <CardContent className="num grid grid-cols-2 gap-y-3 p-5 text-sm">
          <span className="text-slate">Max allocation</span>
          <span className="text-right text-ink">
            {sys.maxAllocation} {sys.maxAllocationAsset}
          </span>
          <span className="text-slate">Execution limit</span>
          <span className="text-right text-ink">{sys.executionLimit}</span>
          <span className="text-slate">Expires</span>
          <span className="text-right text-ink">
            {sys.expiresAt ? formatDateTime(sys.expiresAt, timezone) : "No expiry"}
          </span>
          <span className="text-slate">Created</span>
          <span className="text-right text-ink">{formatDateTime(sys.createdAt, timezone)}</span>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-ink">Steps</h2>
        <div className="mt-3 space-y-2">
          {sys.steps.map((step) => (
            <div key={step.id} className="rounded-lg border border-slate-line bg-white/60 px-4 py-3 text-sm text-ink">
              {step.label}
            </div>
          ))}
          {sys.steps.length === 0 && <p className="text-sm text-slate">No steps configured.</p>}
        </div>
      </div>

      {/* Execution logs */}
      <div className="mb-4 mt-8">
        <h2 className="text-sm font-semibold text-ink">Execution logs</h2>
        <div className="mt-3 divide-y divide-slate-line rounded-lg border border-slate-line bg-white/60">
          {sys.executions.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate">No executions yet.</p>
          )}
          {sys.executions.map((exec) => (
            <div key={exec.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="flex items-start gap-2.5">
                {execStatusIcon[exec.status]}
                <div>
                  <p className="text-sm text-ink">{exec.stepLabel}</p>
                  {exec.errorMessage && <p className="mt-0.5 text-xs text-danger">{exec.errorMessage}</p>}
                  {exec.txHash && <p className="num mt-0.5 text-xs text-slate">{exec.txHash}</p>}
                </div>
              </div>
              <span className="num shrink-0 text-xs text-slate">{formatDateTime(exec.executedAt, timezone)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
