"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { activateSystem } from "@/lib/api/client";
import type { PendingSystemCard } from "@/lib/llm/types";
import { useQueryClient } from "@tanstack/react-query";

export function SystemDraftCard({ card }: { card: PendingSystemCard }) {
  const [state, setState] = useState(card);
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const qc = useQueryClient();

  async function handleActivate() {
    setBusy(true);
    const system = await activateSystem({
      draftSystemId: state.draftSystemId,
      name: state.name,
      maxAllocation: state.maxAllocation,
      maxAllocationAsset: state.maxAllocationAsset,
    });
    setCreatedId(system.id);
    setState((s) => ({ ...s, status: "ACTIVATED" }));
    qc.invalidateQueries({ queryKey: ["systems"] });
    setBusy(false);
  }

  return (
    <div className="w-full max-w-sm rounded-lg border border-slate-line bg-white p-4">
      <p className="text-sm font-medium text-ink">{state.name}</p>
      <p className="mt-1 text-xs text-slate">{state.summary}</p>
      <p className="num mt-2 text-xs text-slate">
        Max allocation {state.maxAllocation} {state.maxAllocationAsset}
      </p>

      {state.status === "AWAITING_ACTIVATION" && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={handleActivate} disabled={busy} className="flex-1">
            {busy ? "Activating…" : "Activate"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setState((s) => ({ ...s, status: "DISMISSED" }))}
            className="flex-1"
          >
            Dismiss
          </Button>
        </div>
      )}
      {state.status === "ACTIVATED" && (
        <div className="mt-4 flex items-center justify-between">
          <Badge tone="active" dot>
            Active
          </Badge>
          {createdId && (
            <Link href={`/app/systems/${createdId}`} className="text-xs font-medium text-accent-dim hover:underline">
              View UPM →
            </Link>
          )}
        </div>
      )}
      {state.status === "DISMISSED" && <Badge tone="inactive">Dismissed</Badge>}
    </div>
  );
}
