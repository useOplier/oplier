"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChat, deleteChat, getChat, listChats, sendChatMessage } from "@/lib/api/client";

export function useChats() {
  return useQuery({ queryKey: ["chats"], queryFn: listChats });
}

export function useChatThread(chatId: string | null) {
  return useQuery({
    queryKey: ["chats", chatId],
    queryFn: () => getChat(chatId as string),
    enabled: !!chatId,
  });
}

export function useCreateChat() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: createChat, onSuccess: () => qc.invalidateQueries({ queryKey: ["chats"] }) });
}

export function useDeleteChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteChat,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chats"] }),
  });
}

export function useSendMessage(chatId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => sendChatMessage(chatId, content),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chats", chatId] });
      qc.invalidateQueries({ queryKey: ["chats"] });
    },
  });
}
