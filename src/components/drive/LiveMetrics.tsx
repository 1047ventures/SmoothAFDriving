import { ScoreEvent } from "@/lib/smoothScore";

interface LiveMetricsProps {
  score: number;
  speed: number;
  events: ScoreEvent[];
  distanceKm: number;
  durationMs: number;
}

export function LiveMetrics({ score, speed, events, distanceKm, durationMs }: LiveMetricsProps) {
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const recentEvents = events.slice(-3).reverse();

  return (
    <div className="space-y-3">
      {/* Speed + Time row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card rounded-xl p-3 text-center border border-border">
          <div className="text-2xl font-bold tabular-nums">{Math.round(speed * 0.621)}</div>
          <div className="text-xs text-muted-foreground">mph</div>
        </div>
        <div className="bg-card rounded-xl p-3 text-center border border-border">
          <div className="text-2xl font-bold tabular-nums">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </div>
          <div className="text-xs text-muted-foreground">time</div>
        </div>
        <div className="bg-card rounded-xl p-3 text-center border border-border">
          <div className="text-2xl font-bold tabular-nums">{(distanceKm * 0.621).toFixed(1)}</div>
          <div className="text-xs text-muted-foreground">miles</div>
        </div>
      </div>

      {/* Recent events */}
      {recentEvents.length > 0 && (
        <div className="space-y-1.5">
          {recentEvents.map((e, i) => (
            <div key={i} className="bg-card rounded-lg px-3 py-2 flex items-center justify-between border border-caution/30">
              <span className="text-xs capitalize text-caution">
                {e.type.replace("_", " ")}
              </span>
              <span className="text-xs text-muted-foreground">
                -{e.penalty} pts · {(e.magnitude).toFixed(2)}g
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
