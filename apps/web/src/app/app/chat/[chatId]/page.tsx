"use client";

import { use } from "react";
import { ChatWindow } from "@/components/chat/ChatWindow";

export default function ChatThreadPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);
  return <ChatWindow chatId={chatId} />;
}
