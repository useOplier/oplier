import { Brain, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function ProductShowcase() {
  return (
    <section id="product" className="border-b border-slate-line bg-paper py-20 sm:py-28">
      <div className="shell">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Built around how you already work.
          </h2>
          <p className="mt-4 text-base text-slate">
            Ask questions, manage positions, and create UPMs through a single conversational
            interface.
          </p>
        </div>

        <div className="mx-auto mt-14 max-w-2xl">
          <div className="overflow-hidden rounded-xl border border-slate-line bg-white shadow-float">
            {/* Header matches ChatWindow.tsx exactly */}
            <div className="flex items-center justify-between border-b border-slate-line px-4 py-3 sm:px-6">
              <p className="truncate text-sm font-medium text-ink">AAPLx dip buyer setup</p>
              <span className="flex h-8 w-8 items-center justify-center rounded-full text-slate">
                <Brain className="h-4 w-4" />
              </span>
            </div>

            {/* Message list matches ChatWindow.tsx's spacing exactly */}
            <div className="space-y-5 px-4 py-6 sm:px-6">
              {/* User bubble — matches MessageBubble.tsx exactly */}
              <div className="flex justify-end">
                <div className="flex max-w-[88%] flex-col items-end gap-2 sm:max-w-[75%]">
                  <div className="rounded-lg rounded-br-sm bg-ink px-4 py-3 text-sm leading-relaxed text-paper">
                    Create a UPM for my AAPLx position: buy more when price falls 5% and exit at
                    12% ROI.
                  </div>
                </div>
              </div>

              {/* Assistant bubble + UPM card — matches MessageBubble.tsx + SystemDraftCard.tsx exactly */}
              <div className="flex justify-start">
                <div className="flex max-w-[88%] flex-col gap-2 sm:max-w-[75%]">
                  <div className="rounded-lg rounded-bl-sm border border-slate-line bg-white px-4 py-3 text-sm leading-relaxed text-ink">
                    Here&apos;s the UPM I can create from that, review the details below.
                  </div>
                  <div className="w-full max-w-sm rounded-lg border border-slate-line bg-white p-4">
                    <p className="text-sm font-medium text-ink">AAPLx dip buyer</p>
                    <p className="mt-1 text-xs text-slate">
                      Buy $10 of AAPLx on -5% price moves, up to $50 total.
                    </p>
                    <p className="num mt-2 text-xs text-slate">Max allocation 50 USDG</p>
                    <div className="mt-4 flex items-center justify-between">
                      <Badge tone="active" dot>
                        Active
                      </Badge>
                      <span className="text-xs font-medium text-accent-dim">View UPM →</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Composer matches Composer.tsx exactly */}
            <div className="flex items-end gap-3 border-t border-slate-line bg-paper px-4 py-3 sm:px-6">
              <div className="flex-1 rounded-md border border-slate-line bg-white px-3.5 py-2.5 text-sm text-slate">
                Ask Oplier anything about your portfolio...
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-paper">
                <ArrowUp className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
