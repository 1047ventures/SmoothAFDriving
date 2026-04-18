import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

interface AppLayoutProps {
  children: ReactNode;
  hideNav?: boolean;
  className?: string;
}

export function AppLayout({ children, hideNav = false, className }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <main className={`${hideNav ? "" : "safe-bottom"} ${className ?? ""}`}>
        {children}
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
