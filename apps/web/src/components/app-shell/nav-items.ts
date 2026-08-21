import { Home, MessageCircle, ListChecks, Wallet, Activity, SlidersHorizontal } from "lucide-react";

export const navItems = [
  { href: "/app/home", label: "Home", icon: Home },
  { href: "/app/chat", label: "Chat", icon: MessageCircle },
  { href: "/app/systems", label: "UPMs", icon: ListChecks },
  { href: "/app/positions", label: "Positions", icon: Wallet },
  { href: "/app/activity", label: "Activity", icon: Activity },
] as const;

// Settings deliberately excluded from the primary nav surface (doc 01 §16:
// "should not have a large settings area") — reachable via the top bar icon
// on both desktop and mobile instead of taking a slot among the four
// screens the product is actually built around.
export const settingsItem = { href: "/app/settings", label: "Settings", icon: SlidersHorizontal };
