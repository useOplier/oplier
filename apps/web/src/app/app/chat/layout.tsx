"use client";

import { ChatListPanel } from "@/components/chat/ChatListPanel";
import { useUiStore } from "@/store/useUiStore";
import { cn } from "@/lib/utils";
import { PanelLeftOpen } from "lucide-react";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const collapsed = useUiStore((s) => s.chatListCollapsed);
  const setChatListCollapsed = useUiStore((s) => s.setChatListCollapsed);

  return (
    <div className="relative flex h-full">
      {/* Desktop-collapsible list panel. The inner div stays a fixed w-72 so
          ChatListPanel never reflows; the outer wrapper animates width/border
          to 0 when collapsed, giving the thread the reclaimed space. Hidden
          entirely below md — mobile already gets its own list via the
          /app/chat index route, this toggle only applies at desktop widths. */}
      <div
        className={cn(
          "hidden shrink-0 overflow-hidden border-slate-line transition-[width] duration-200 md:block",
          collapsed ? "w-0 border-r-0" : "w-72 border-r"
        )}
      >
        <div className="h-full w-72">
          <ChatListPanel />
        </div>
      </div>
      <div className="min-w-0 flex-1">{children}</div>

      {/*
        The ONLY control that re-opens the collapsed list, and it lives here rather than in
        ChatWindow on purpose.

        THE BUG THIS FIXES: the expand button used to be rendered inside ChatWindow's header, and
        ChatWindow only mounts when a chat is actually open. Collapse the list while on the chat index
        with no thread selected (e.g. a new account showing "No chats yet") and there was no way back —
        no button anywhere, and the state persists, so the list stayed gone. This layout renders on
        every /app/chat route regardless of the child, so the control can't disappear.

        md-only, matching the collapse itself, which is desktop-only (mobile uses its own index route).
      */}
      {collapsed && (
        <button
          onClick={() => setChatListCollapsed(false)}
          className="absolute left-3 top-3 z-20 hidden h-8 w-8 items-center justify-center rounded-full border border-slate-line bg-paper text-slate shadow-sm transition-colors hover:bg-ink/[0.05] hover:text-ink md:flex"
          aria-label="Expand chat list"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
