"use client";

import Link from "next/link";
import { Pause, Play, Trash2, Info, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSystemActions } from "@/hooks/useSystems";
import type { SystemSpec } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const statusStyles: Record<SystemSpec["status"], string> = {
  ACTIVE: "border-accent/40 bg-accent-tint/40",
  PAUSED: "border-slate-line bg-slate-surface/50",
  AUTHORIZATION_REQUIRED: "border-[#E9C77B] bg-[#FBEFD9]/50",
  HALTED: "border-[#E0A0A0] bg-[#FBE9E9]/50",
  COMPLETE: "border-slate-line bg-white",
  EXPIRED: "border-slate-line bg-white opacity-70",
};

const statusBadge: Record<SystemSpec["status"], { tone: "active" | "inactive" | "warning" | "neutral"; label: string }> = {
  ACTIVE: { tone: "active", label: "Active" },
  PAUSED: { tone: "inactive", label: "Paused" },
  AUTHORIZATION_REQUIRED: { tone: "warning", label: "Needs authorization" },
  HALTED: { tone: "warning", label: "Halted" },
  COMPLETE: { tone: "neutral", label: "Complete" },
  EXPIRED: { tone: "neutral", label: "Expired" },
};

export function SystemCard({ system }: { system: SystemSpec }) {
  const { pause, resume, remove } = useSystemActions();
  const badge = statusBadge[system.status];

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm(`Delete "${system.name}"? This permanently revokes its permissions and can't be undone.`)) {
      remove.mutate(system.id);
    }
  }

  function handlePauseResume(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (system.status === "ACTIVE") pause.mutate(system.id);
    else if (system.status === "PAUSED") resume.mutate(system.id);
  }

  const canToggle = system.status === "ACTIVE" || system.status === "PAUSED";

  return (
    <Link
      href={`/app/systems/${system.id}`}
      className={cn("block rounded-lg border p-4 transition-shadow hover:shadow-card", statusStyles[system.status])}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-ink">{system.name}</p>
            {system.hasWarning && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#8A6116]" />}
          </div>
          <Badge tone={badge.tone} dot={system.status === "ACTIVE"} className="mt-2">
            {badge.label}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canToggle && (
            <button
              onClick={handlePauseResume}
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink/70 transition-colors hover:bg-ink/[0.06] hover:text-ink"
              aria-label={system.status === "ACTIVE" ? "Pause" : "Resume"}
            >
              {system.status === "ACTIVE" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={handleDelete}
            className="flex h-8 w-8 items-center justify-center rounded-md text-ink/70 transition-colors hover:bg-danger/10 hover:text-danger"
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-md text-ink/70">
            <Info className="h-4 w-4" />
          </span>
        </div>
      </div>
      <p className="num mt-3 text-xs text-slate">
        Max allocation {system.maxAllocation} {system.maxAllocationAsset}
      </p>
    </Link>
  );
}
