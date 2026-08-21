"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Trash2, PanelLeftClose } from "lucide-react";
import { useChats, useCreateChat, useDeleteChat } from "@/hooks/useChat";
import { useUiStore } from "@/store/useUiStore";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ChatListPanel({ className }: { className?: string }) {
  const chats = useChats();
  const createChat = useCreateChat();
  const deleteChat = useDeleteChat();
  const pathname = usePathname();
  const router = useRouter();
  const setChatListCollapsed = useUiStore((s) => s.setChatListCollapsed);

  async function handleNewChat() {
    const chat = await createChat.mutateAsync();
    router.push(`/app/chat/${chat.id}`);
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    // Irreversible, and explicitly does not touch the Memory Summary — copy
    // says so directly so users don't conflate "delete chat" with "forget
    // what Oplier knows about me" in either direction (brief's product-context note).
    const confirmed = window.confirm(
      "Delete this chat? This can't be undone. Your Memory Summary, what Oplier remembers about you across chats, is not affected."
    );
    if (!confirmed) return;
    deleteChat.mutate(id, {
      onSuccess: () => {
        if (pathname === `/app/chat/${id}`) router.push("/app/chat");
      },
    });
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center justify-between px-4 py-3.5">
        <h2 className="text-sm font-semibold text-ink">Chats</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            disabled={createChat.isPending}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink transition-colors hover:bg-ink/[0.06] disabled:opacity-50"
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setChatListCollapsed(true)}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-ink transition-colors hover:bg-ink/[0.06] md:flex"
            aria-label="Collapse chat list"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {chats.isLoading &&
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="mx-2 h-10 rounded-md" />)}
        {chats.data?.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate">No chats yet.</p>
        )}
        {chats.data?.map((chat) => {
          const active = pathname === `/app/chat/${chat.id}`;
          return (
            <Link
              key={chat.id}
              href={`/app/chat/${chat.id}`}
              className={cn(
                "group flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm transition-colors",
                active ? "bg-ink text-paper" : "text-ink/80 hover:bg-ink/[0.05]"
              )}
            >
              <span className="truncate">{chat.title}</span>
              <button
                onClick={(e) => handleDelete(e, chat.id)}
                className={cn(
                  "shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100",
                  active ? "text-paper/70 hover:text-paper" : "text-slate hover:text-danger"
                )}
                aria-label="Delete chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
