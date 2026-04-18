import { LucideIcon } from "lucide-react";

interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  color?: "smooth" | "caution" | "alert" | "default";
}

const colorMap = {
  smooth: "text-smooth",
  caution: "text-caution",
  alert: "text-alert",
  default: "text-foreground",
};

export function MetricCard({ icon: Icon, label, value, unit, color = "default" }: MetricCardProps) {
  return (
    <div className="bg-card rounded-xl p-4 flex flex-col gap-2 border border-border">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className={`flex items-baseline gap-1 ${colorMap[color]}`}>
        <span className="text-2xl font-bold tabular-nums">{value}</span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
    </div>
  );
}
