import { NavLink } from "react-router-dom";
import { LayoutDashboard, Navigation, Route, Wrench, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { to: "/drive", icon: Navigation, label: "Drive" },
  { to: "/trips", icon: Route, label: "Trips" },
  { to: "/diagnostics", icon: Wrench, label: "Garage" },
  { to: "/concierge", icon: Mic, label: "Concierge" },
];

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="flex">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs transition-colors",
                isActive
                  ? "text-smooth"
                  : "text-muted-foreground hover:text-foreground"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn("h-5 w-5", isActive && "drop-shadow-[0_0_6px_hsl(142_69%_58%)]")} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
