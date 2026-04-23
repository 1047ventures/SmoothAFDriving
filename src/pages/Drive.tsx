import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDriveSession } from "@/hooks/useDriveSession";
import { useOBD } from "@/hooks/useOBD";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { ScoreRing } from "@/components/dashboard/ScoreRing";
import { LiveMetrics } from "@/components/drive/LiveMetrics";
import { Button } from "@/components/ui/button";
import { Bluetooth, Square, ChevronLeft, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Drive() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, session, currentScore, motionActive, currentG, start, stop } = useDriveSession();
  const { obdStatus, obdData, connect: connectOBD } = useOBD();
  const [elapsed, setElapsed] = useState(0);
  const [motionWarning, setMotionWarning] = useState(false);

  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);

  // Elapsed timer
  useEffect(() => {
    if (status !== "active") return;
    const interval = setInterval(() => {
      setElapsed(session ? Date.now() - session.startedAt : 0);
    }, 1000);
    return () => clearInterval(interval);
  }, [status, session]);

  // Warn if motion data hasn't arrived within 5s of starting
  useEffect(() => {
    if (status !== "active") { setMotionWarning(false); return; }
    if (motionActive) { setMotionWarning(false); return; }
    const t = setTimeout(() => setMotionWarning(true), 5000);
    return () => clearTimeout(t);
  }, [status, motionActive]);

  const handleStart = async () => {
    if (typeof DeviceMotionEvent !== "undefined" &&
      typeof (DeviceMotionEvent as any).requestPermission === "function") {
      try {
        const perm = await (DeviceMotionEvent as any).requestPermission();
        if (perm !== "granted") {
          toast({ title: "Motion access needed", description: "Settings → Privacy → Motion & Fitness → enable for this browser", variant: "destructive" });
          return;
        }
      } catch { /* non-iOS */ }
    }
    setElapsed(0);
    await start();
    toast({ title: "Trip started", description: "Drive smoothly!" });
  };

  const handleStop = async () => {
    const ended = stop();
    if (!ended || !user) return;

    const finalScore = ended.scoreState.windowSamples.length >= 10
      ? ended.scoreState.score
      : null;

    if (finalScore == null) {
      toast({ title: "Trip ended", description: "No motion data — check sensor permissions.", variant: "destructive" });
      navigate("/dashboard");
      return;
    }

    const distMiles = ended.distanceKm * 0.621371;
    const avgSpeedMph = ended.route.length > 0
      ? (ended.route.reduce((s, p) => s + p.speed, 0) / ended.route.length) * 0.621
      : 0;
    const maxG = Math.max(...ended.scoreState.windowSamples.map(s => Math.abs(s.ay)), 0);

    await supabase.from("trips").insert({
      user_id: user.id,
      started_at: new Date(ended.startedAt).toISOString(),
      ended_at: new Date(ended.endedAt!).toISOString(),
      distance_miles: distMiles,
      smooth_score: finalScore,
      max_g_force: maxG,
      avg_speed_mph: avgSpeedMph,
      hard_brakes: ended.scoreState.hardBrakes,
      hard_accels: ended.scoreState.hardAccels,
      hard_corners: ended.scoreState.hardCorners,
      route: ended.route,
    });

    toast({ title: "Trip saved!", description: `Score: ${Math.round(finalScore)}` });
    navigate("/dashboard");
  };

  const displaySpeed = obdData.speed
    ? (obdData.speed * 0.621).toFixed(0)
    : (session?.route.at(-1)?.speed ?? 0 * 0.621).toFixed(0);

  return (
    <AppLayout hideNav={status === "active"}>
      <div className="px-4 pt-6 pb-4">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          {status !== "active" && (
            <Button size="icon" variant="ghost" onClick={() => navigate("/dashboard")}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
          )}
          <h1 className="font-bold text-lg">
            {status === "active" ? "Driving" : "Ready to drive"}
          </h1>
          {status !== "active" && obdStatus !== "connected" && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={connectOBD}>
              <Bluetooth className="h-4 w-4 mr-1.5" />
              OBD-II
            </Button>
          )}
          {obdStatus === "connected" && (
            <span className="ml-auto text-xs text-smooth flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-smooth animate-dot-ping" />
              OBD live
            </span>
          )}
        </div>

        {/* Motion sensor status (active trips only) */}
        {status === "active" && (
          <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 mb-4 text-xs ${
            motionActive ? "bg-smooth/10 text-smooth" : "bg-secondary text-muted-foreground"
          }`}>
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${motionActive ? "bg-smooth animate-dot-ping" : "bg-muted-foreground"}`} />
              {motionActive ? "Motion sensor active" : "Waiting for sensor…"}
            </span>
            {motionActive && (
              <span className="tabular-nums font-mono">{currentG.toFixed(3)} g</span>
            )}
          </div>
        )}

        {/* Motion warning */}
        {motionWarning && (
          <div className="flex items-start gap-2 bg-caution/10 border border-caution/30 rounded-xl p-3 mb-4 text-xs text-caution">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>No motion data received. Go to <strong>Settings → Privacy → Motion &amp; Fitness</strong> and enable access for this browser.</span>
          </div>
        )}

        {/* Score ring */}
        <div className="flex justify-center mb-6">
          <ScoreRing score={currentScore} size={200} animated={status === "active"} />
        </div>

        {/* Live OBD data strip */}
        {obdStatus === "connected" && (
          <div className="grid grid-cols-4 gap-2 mb-4">
            {[
              { label: "mph",     value: Number(displaySpeed) },
              { label: "rpm",     value: Math.round(obdData.rpm ?? 0) },
              { label: "°F cool", value: obdData.coolantTemp ? Math.round(obdData.coolantTemp * 9/5 + 32) : "--" },
              { label: "% fuel",  value: obdData.fuelLevel ? Math.round(obdData.fuelLevel) : "--" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card rounded-lg p-2 text-center border border-border">
                <div className="text-base font-bold tabular-nums">{value}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Live metrics */}
        {status === "active" && session && currentScore != null && (
          <div className="mb-6">
            <LiveMetrics
              score={currentScore}
              speed={Number(displaySpeed)}
              events={session.scoreState.events}
              distanceKm={session.distanceKm}
              durationMs={elapsed}
            />
          </div>
        )}

        {/* HUD note */}
        {status !== "active" && (
          <div className="bg-card rounded-xl p-4 border border-border mb-6">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="text-foreground font-medium">HUD mode:</span> Mount your Smooth AF Driving cam unit on the windshield.
              The projector will automatically overlay the smooth-line guidance once a trip starts.
              App scoring runs independently on your phone.
            </p>
          </div>
        )}

        {/* Start / Stop */}
        {status === "idle" || status === "ended" ? (
          <Button
            onClick={handleStart}
            className="w-full bg-smooth text-background font-bold rounded-xl py-6 text-lg glow-smooth"
          >
            Start trip
          </Button>
        ) : (
          <Button
            onClick={handleStop}
            variant="outline"
            className="w-full border-alert text-alert font-bold rounded-xl py-6 text-lg"
          >
            <Square className="mr-2 h-5 w-5 fill-current" />
            End trip
          </Button>
        )}
      </div>
    </AppLayout>
  );
}
