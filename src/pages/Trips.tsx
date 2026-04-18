import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { TripCard, TripSummary } from "@/components/dashboard/TripCard";
import { ScoreRing } from "@/components/dashboard/ScoreRing";
import { useEffect } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Route } from "lucide-react";
import { format } from "date-fns";

export default function Trips() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);

  const { data: trips = [], isLoading } = useQuery<TripSummary[]>({
    queryKey: ["trips-all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, started_at, distance_miles, smooth_score, hard_brakes, hard_accels, avg_speed_mph")
        .eq("user_id", user!.id)
        .order("started_at", { ascending: false })
        .limit(50);
      return (data ?? []) as TripSummary[];
    },
  });

  const chartData = [...trips]
    .reverse()
    .slice(-14)
    .map(t => ({
      date: format(new Date(t.started_at), "M/d"),
      score: Math.round(t.smooth_score),
    }));

  const avgScore = trips.length > 0
    ? trips.reduce((s, t) => s + t.smooth_score, 0) / trips.length
    : 0;

  const totalMiles = trips.reduce((s, t) => s + (t.distance_miles ?? 0), 0);

  return (
    <AppLayout>
      <div className="px-4 pt-6 pb-4">
        <h1 className="font-bold text-xl mb-6">Trip history</h1>

        {trips.length > 0 && (
          <>
            {/* Summary row */}
            <div className="flex items-center gap-6 mb-6">
              <ScoreRing score={avgScore} size={100} />
              <div className="space-y-1">
                <div className="text-2xl font-bold">{trips.length}</div>
                <div className="text-xs text-muted-foreground">total trips</div>
                <div className="text-2xl font-bold">{totalMiles.toFixed(0)}</div>
                <div className="text-xs text-muted-foreground">miles driven</div>
              </div>
            </div>

            {/* Score trend chart */}
            {chartData.length > 1 && (
              <div className="bg-card rounded-xl p-4 border border-border mb-6">
                <p className="text-xs text-muted-foreground mb-3">Score trend (last 14 trips)</p>
                <ResponsiveContainer width="100%" height={80}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(142 69% 58%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(142 69% 58%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(0 0% 60%)" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip
                      contentStyle={{ background: "hsl(0 0% 9%)", border: "1px solid hsl(0 0% 16%)", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(0 0% 96%)" }}
                      itemStyle={{ color: "hsl(142 69% 58%)" }}
                    />
                    <Area type="monotone" dataKey="score" stroke="hsl(142 69% 58%)" strokeWidth={2} fill="url(#scoreGrad)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </>
        )}

        {/* Trip list */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-card rounded-xl h-20 border border-border animate-pulse" />
            ))}
          </div>
        ) : trips.length === 0 ? (
          <div className="bg-card rounded-xl p-12 border border-border text-center">
            <Route className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No trips yet. Start your first drive!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {trips.map(trip => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
