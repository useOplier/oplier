import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/llm/types";
import { TransactionCard } from "./TransactionCard";
import { SystemDraftCard } from "./SystemDraftCard";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[88%] flex-col gap-2 sm:max-w-[75%]", isUser && "items-end")}>
        {/* whitespace-pre-line: the assistant writes markdown-ish replies with real newlines
            (bullet lists, paragraphs). Without it every \n collapses and lists render as one
            cramped paragraph. */}
        <div
          className={cn(
            "whitespace-pre-line rounded-lg px-4 py-3 text-sm leading-relaxed",
            isUser
              ? "rounded-br-sm bg-ink text-paper"
              : "rounded-bl-sm border border-slate-line bg-white text-ink"
          )}
        >
          {message.content}
        </div>
        {message.pendingTransaction && <TransactionCard card={message.pendingTransaction} />}
        {message.pendingSystem && <SystemDraftCard card={message.pendingSystem} />}
      </div>
    </div>
  );
}
