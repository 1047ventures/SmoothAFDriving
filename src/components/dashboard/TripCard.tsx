import { formatDistanceToNow } from "date-fns";
import { MapPin, Clock, Gauge } from "lucide-react";
import { scoreColor, scoreLabel } from "@/lib/smoothScore";

export interface TripSummary {
  id: string;
  started_at: string;
  distance_miles: number;
  smooth_score: number;
  hard_brakes: number;
  hard_accels: number;
  avg_speed_mph: number;
}

interface TripCardProps {
  trip: TripSummary;
  onClick?: () => void;
}

export function TripCard({ trip, onClick }: TripCardProps) {
  const color = scoreColor(trip.smooth_score);
  const label = scoreLabel(trip.smooth_score);
  const ago = formatDistanceToNow(new Date(trip.started_at), { addSuffix: true });
  const durationMs = 0; // would come from ended_at - started_at

  return (
    <button
      onClick={onClick}
      className="w-full bg-card rounded-xl p-4 border border-border flex items-center gap-4 text-left hover:border-border/80 active:scale-[0.98] transition-transform"
    >
      {/* Score badge */}
      <div
        className="flex-shrink-0 w-14 h-14 rounded-full flex flex-col items-center justify-center border-2"
        style={{ borderColor: color, boxShadow: `0 0 12px ${color}33` }}
      >
        <span className="text-lg font-bold tabular-nums" style={{ color }}>
          {Math.round(trip.smooth_score)}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-sm">{label}</span>
          <span className="text-xs text-muted-foreground">{ago}</span>
        </div>
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {trip.distance_miles.toFixed(1)} mi
          </span>
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" />
            {Math.round(trip.avg_speed_mph)} mph avg
          </span>
          {(trip.hard_brakes + trip.hard_accels) > 0 && (
            <span className="text-caution">
              {trip.hard_brakes + trip.hard_accels} events
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
