"use client";

import { create } from "zustand";

interface UiState {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  memoryModalOpen: boolean;
  setMemoryModalOpen: (open: boolean) => void;
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;
  /** Desktop-only: collapses the Chat screen's chat-list panel for more thread width. */
  chatListCollapsed: boolean;
  setChatListCollapsed: (collapsed: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
  memoryModalOpen: false,
  setMemoryModalOpen: (open) => set({ memoryModalOpen: open }),
  activeChatId: null,
  setActiveChatId: (id) => set({ activeChatId: id }),
  chatListCollapsed: false,
  setChatListCollapsed: (collapsed) => set({ chatListCollapsed: collapsed }),
}));
