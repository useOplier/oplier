"use client";

import { useState } from "react";
import { useSignMessage } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";
import { reportTransactionOutcome } from "@/lib/api/client";
import type { PendingTransactionCard } from "@/lib/llm/types";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

/**
 * doc 02 "One-off transactions": Approve is not itself the signature — the
 * wallet signing flow is the real authorization, this button just triggers
 * it. `POST /transactions/prepare`'s real on-chain construction is Part E's
 * job (LLM_CONTRACT.md §4 flags `prepare_transaction` as UNCONFIRMED); until
 * that exists, Approve triggers a wagmi signature over the transaction
 * summary as a stand-in for "the user's normal wallet signing flow" so the
 * UI-level contract (two explicit buttons, real wallet interaction, Cancel
 * stops immediately) is genuinely exercised rather than faked with a timeout.
 */
export function TransactionCard({ card }: { card: PendingTransactionCard }) {
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState(card);
  const [busy, setBusy] = useState(false);

  async function handleApprove() {
    setBusy(true);
    try {
      const summary = `Approve Oplier transaction ${state.transactionId}: swap ${state.amount} ${state.amountAsset} for ~${state.estimatedReceiveAmount.toFixed(4)} ${state.toAsset} (max slippage ${state.maxSlippagePercent}%).`;
      const signature = await signMessageAsync({ message: summary });
      const result = await reportTransactionOutcome(state.transactionId, "SUCCESS", signature.slice(0, 10) + "…");
      setState(result);
    } catch {
      const result = await reportTransactionOutcome(state.transactionId, "FAILED");
      setState(result);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    const result = await reportTransactionOutcome(state.transactionId, "CANCELLED");
    setState(result);
    setBusy(false);
  }

  const resolved = state.status !== "AWAITING_APPROVAL";

  return (
    <div className="w-full max-w-sm rounded-lg border border-slate-line bg-white p-4">
      <dl className="num grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-slate">Swap</dt>
        <dd>
          {state.amount} {state.amountAsset} → {state.toAsset}
        </dd>
        <dt className="text-slate">Est. receive</dt>
        <dd>
          {state.estimatedReceiveAmount.toFixed(4)} {state.toAsset}
        </dd>
        <dt className="text-slate">Est. price</dt>
        <dd>{formatUsd(state.estimatedPriceUsd)}</dd>
        <dt className="text-slate">Max slippage</dt>
        <dd>{state.maxSlippagePercent}%</dd>
      </dl>

      {!resolved ? (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={handleApprove} disabled={busy} className="flex-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleCancel} disabled={busy} className="flex-1">
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          {state.status === "SUCCESS" && (
            <Badge tone="active" dot>
              <CheckCircle2 className="h-3 w-3" /> Completed
            </Badge>
          )}
          {state.status === "FAILED" && (
            <Badge tone="danger">
              <XCircle className="h-3 w-3" /> Failed
            </Badge>
          )}
          {state.status === "CANCELLED" && <Badge tone="inactive">Cancelled</Badge>}
          {state.txHash && <p className="num mt-2 text-xs text-slate">{state.txHash}</p>}
        </div>
      )}
    </div>
  );
}
