"use client";

import { MessageCircle } from "lucide-react";
import { ChatListPanel } from "@/components/chat/ChatListPanel";
import { EmptyState } from "@/components/ui/empty-state";
import { useCreateChat } from "@/hooks/useChat";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export default function ChatIndexPage() {
  const router = useRouter();
  const createChat = useCreateChat();

  async function handleNewChat() {
    const chat = await createChat.mutateAsync();
    router.push(`/app/chat/${chat.id}`);
  }

  return (
    <>
      <div className="h-full md:hidden">
        <ChatListPanel />
      </div>
      <div className="hidden h-full items-center justify-center px-6 md:flex">
        <EmptyState
          icon={MessageCircle}
          title="Select a chat"
          description="Pick a conversation from the list, or start a new one."
          action={
            <Button size="sm" onClick={handleNewChat}>
              New chat
            </Button>
          }
        />
      </div>
    </>
  );
}
