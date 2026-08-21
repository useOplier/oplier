import { AuthGate } from "@/components/app-shell/AuthGate";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { MobileTabBar } from "@/components/app-shell/MobileTabBar";
import { TopBar } from "@/components/app-shell/TopBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <div className="flex min-h-svh bg-paper">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex-1 pb-20 md:pb-0">{children}</main>
        </div>
      </div>
      <MobileTabBar />
    </AuthGate>
  );
}
