"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  walletAddress: string | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  setSession: (walletAddress: string, accessToken: string) => void;
  clearSession: () => void;
}

/**
 * Real session strategy per API_CONTRACT.md §1: short-lived (15 min) bearer
 * access token in JS memory + an httpOnly refresh cookie the frontend never
 * touches directly. Persisting `accessToken` to localStorage here is a mock
 * convenience only (so a page refresh doesn't lose the demo session) — a
 * real build should keep the access token in memory and rely on
 * `POST /auth/refresh` against the httpOnly cookie instead. Flagged in
 * README "What's mocked".
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      walletAddress: null,
      accessToken: null,
      isAuthenticated: false,
      setSession: (walletAddress, accessToken) =>
        set({ walletAddress, accessToken, isAuthenticated: true }),
      clearSession: () => set({ walletAddress: null, accessToken: null, isAuthenticated: false }),
    }),
    { name: "oplier-auth" }
  )
);
