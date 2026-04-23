import { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { APP_VERSION } from "@/lib/version";

interface AppLayoutProps {
  children: ReactNode;
  hideNav?: boolean;
  className?: string;
}

export function AppLayout({ children, hideNav = false, className }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex justify-end px-4 py-1 border-b border-border/40">
        <span className="text-[10px] font-mono text-muted-foreground/50 tracking-widest">
          {APP_VERSION}
        </span>
      </div>
      <main className={`${hideNav ? "" : "safe-bottom"} ${className ?? ""}`}>
        {children}
      </main>
      {!hideNav && <BottomNav />}
    </div>
  );
}
