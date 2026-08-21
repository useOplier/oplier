"use client";

import { useEffect, useRef, useState } from "react";
import { useChatThread, useSendMessage } from "@/hooks/useChat";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { MemoryModal } from "./MemoryModal";
import { Skeleton } from "@/components/ui/skeleton";

export function ChatWindow({ chatId }: { chatId: string }) {
  const thread = useChatThread(chatId);
  const sendMessage = useSendMessage(chatId);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const collapsed = useUiStore((s) => s.chatListCollapsed);
  const setChatListCollapsed = useUiStore((s) => s.setChatListCollapsed);
  // Turns can legitimately take 30-90s (LLM rounds + tool calls). A static "Thinking…" looks
  // frozen; tick elapsed seconds so it's obviously alive.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread.data?.messages.length, sendMessage.isPending]);

  useEffect(() => {
    if (!sendMessage.isPending) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sendMessage.isPending]);

  return (
    // h-full, not a hardcoded 100svh calc: this panel sits inside AppLayout's
    // <main>, which already reserves the right amount of space above the
    // fixed mobile tab bar (pb-20, removed at md via pb-0). Resolving against
    // the parent's real height instead of recomputing viewport math here is
    // what keeps the composer from ending up hidden behind the tab bar on
    // mobile.
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-line px-4 py-3 sm:px-6">
        {/* The expand-list control lives in app/chat/layout.tsx, not here: this component only mounts
            when a chat is open, so a button here was unreachable with no thread selected. */}
        <p className={cn("min-w-0 flex-1 truncate text-sm font-medium text-ink", collapsed && "md:pl-9")}>
          {thread.data?.title ?? "Chat"}
        </p>
        <MemoryModal />
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6">
        {thread.isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-2/3 rounded-lg" />)}
        {thread.data?.messages.length === 0 && (
          <p className="mt-10 text-center text-sm text-slate">
            Ask about your portfolio, upcoming events, or describe a UPM you&apos;d like to create.
          </p>
        )}
        {thread.data?.messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {/* Optimistic echo of the just-sent user message: the POST only resolves when the whole
            assistant turn finishes (LLM rounds + tool calls can take ~30-90s), and the thread
            refetch happens after that — without this, your own message doesn't appear until the
            reply lands. `variables` holds exactly what was submitted. */}
        {sendMessage.isPending && sendMessage.variables != null && (
          <MessageBubble
            key="pending-user-message"
            message={{ id: "pending-user", role: "user", content: sendMessage.variables, createdAt: new Date().toISOString() }}
          />
        )}
        {sendMessage.isPending && (
          <div className="flex justify-start">
            <div className="rounded-lg rounded-bl-sm border border-slate-line bg-white px-4 py-3 text-sm text-slate">
              Thinking… <span className="tabular-nums text-slate/60">{elapsed}s</span>
            </div>
          </div>
        )}
        {/* A failed send used to vanish silently (optimistic bubble unmounts, no reply ever
            comes). Say something — e.g. LLM provider quota/capacity errors surface as 500s. */}
        {sendMessage.isError && (
          <div className="flex justify-start">
            <div className="rounded-lg rounded-bl-sm border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Couldn't get a reply just now — the assistant may be rate-limited or offline.
              Please try again.
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <Composer onSend={(text) => sendMessage.mutate(text)} disabled={sendMessage.isPending} />
    </div>
  );
}
