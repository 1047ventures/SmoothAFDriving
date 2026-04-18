import { AlertTriangle, AlertCircle, Info } from "lucide-react";
import { DTCInfo } from "@/lib/obdProtocol";

interface DTCCardProps {
  dtc: DTCInfo;
}

const severityConfig = {
  high: { icon: AlertTriangle, color: "text-alert", border: "border-alert/30", bg: "bg-alert/5" },
  medium: { icon: AlertCircle, color: "text-caution", border: "border-caution/30", bg: "bg-caution/5" },
  low: { icon: Info, color: "text-muted-foreground", border: "border-border", bg: "bg-card" },
};

export function DTCCard({ dtc }: DTCCardProps) {
  const { icon: Icon, color, border, bg } = severityConfig[dtc.severity];

  return (
    <div className={`rounded-xl p-4 border ${border} ${bg} flex gap-3`}>
      <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`font-mono font-bold text-sm ${color}`}>{dtc.code}</span>
          <span className="text-xs text-muted-foreground bg-secondary rounded px-1.5 py-0.5">
            {dtc.system}
          </span>
        </div>
        <p className="text-sm text-foreground leading-snug">{dtc.description}</p>
        <span className={`text-xs capitalize mt-1 inline-block ${color}`}>{dtc.severity} severity</span>
      </div>
    </div>
  );
}
