import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { ScoreRing } from "@/components/dashboard/ScoreRing";
import { TripCard, TripSummary } from "@/components/dashboard/TripCard";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Button } from "@/components/ui/button";
import { Navigation, Route, Wrench, Settings, LogOut, ChevronRight, Activity } from "lucide-react";
import { useEffect } from "react";

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user!.id)
        .single();
      return data;
    },
  });

  const { data: trips = [] } = useQuery<TripSummary[]>({
    queryKey: ["trips-recent", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("trips")
        .select("id, started_at, distance_miles, smooth_score, hard_brakes, hard_accels, avg_speed_mph")
        .eq("user_id", user!.id)
        .order("started_at", { ascending: false })
        .limit(5);
      return (data ?? []) as TripSummary[];
    },
  });

  const { data: latestDiag } = useQuery({
    queryKey: ["diag-latest", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("diagnostics")
        .select("dtc_codes, scanned_at")
        .eq("user_id", user!.id)
        .order("scanned_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
  });

  const avgScore = profile?.avg_score ?? (trips.length > 0
    ? trips.reduce((s, t) => s + t.smooth_score, 0) / trips.length
    : 0);

  const dtcCount = latestDiag?.dtc_codes
    ? (latestDiag.dtc_codes as any[]).length
    : 0;

  return (
    <AppLayout>
      <div className="px-4 pt-6 pb-4 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-bold text-xl">
              <span className="text-smooth">SMOOTH</span>DRIVE
            </h1>
            <p className="text-xs text-muted-foreground">
              {profile?.full_name ?? user?.email?.split("@")[0] ?? "Driver"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="icon" variant="ghost" onClick={() => navigate("/settings")}>
              <Settings className="h-5 w-5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={signOut}>
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Score ring */}
        <div className="flex flex-col items-center py-4 mb-6">
          <ScoreRing score={avgScore} size={180} />
          <p className="text-xs text-muted-foreground mt-3">Overall smooth score</p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <MetricCard
            icon={Route}
            label="Trips"
            value={profile?.total_trips ?? trips.length}
            color="default"
          />
          <MetricCard
            icon={Activity}
            label="Miles"
            value={profile?.total_miles?.toFixed(0) ?? "0"}
            color="default"
          />
          <MetricCard
            icon={Wrench}
            label="Fault codes"
            value={dtcCount}
            color={dtcCount > 0 ? "alert" : "smooth"}
          />
        </div>

        {/* Drive CTA */}
        <Button
          className="w-full bg-smooth text-background font-bold rounded-xl py-6 text-base mb-6 glow-smooth"
          onClick={() => navigate("/drive")}
        >
          <Navigation className="mr-2 h-5 w-5" />
          Start driving
        </Button>

        {/* Vehicle health quick view */}
        {dtcCount > 0 && (
          <button
            onClick={() => navigate("/diagnostics")}
            className="w-full bg-alert/10 border border-alert/30 rounded-xl p-4 flex items-center justify-between mb-6"
          >
            <div className="flex items-center gap-3">
              <Wrench className="h-5 w-5 text-alert" />
              <div className="text-left">
                <div className="text-sm font-medium text-alert">{dtcCount} fault code{dtcCount > 1 ? "s" : ""} detected</div>
                <div className="text-xs text-muted-foreground">Tap to view diagnostics</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        )}

        {/* Recent trips */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm">Recent trips</h2>
            <button
              onClick={() => navigate("/trips")}
              className="text-xs text-smooth flex items-center gap-0.5"
            >
              View all <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {trips.length === 0 ? (
            <div className="bg-card rounded-xl p-8 border border-border text-center">
              <Navigation className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No trips yet. Hit the road!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trips.map(trip => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
