import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useOBD } from "@/hooks/useOBD";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { DTCCard } from "@/components/diagnostics/DTCCard";
import { Button } from "@/components/ui/button";
import { Bluetooth, ScanLine, Trash2, Mic, Activity, ThumbsUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Diagnostics() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { obdStatus, obdData, dtcCodes, error, connect, disconnect, pollPIDs, scanDTCs, clearDTCs } = useOBD();
  const [scanning, setScanning] = useState(false);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);

  // Auto-poll PIDs when connected
  useEffect(() => {
    if (obdStatus !== "connected") return;
    setPolling(true);
    const interval = setInterval(pollPIDs, 3000);
    pollPIDs();
    return () => { clearInterval(interval); setPolling(false); };
  }, [obdStatus, pollPIDs]);

  const { data: lastDiag } = useQuery({
    queryKey: ["diag-history", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("diagnostics")
        .select("*")
        .eq("user_id", user!.id)
        .order("scanned_at", { ascending: false })
        .limit(3);
      return data ?? [];
    },
  });

  const saveDiag = useMutation({
    mutationFn: async () => {
      await supabase.from("diagnostics").insert({
        user_id: user!.id,
        dtc_codes: dtcCodes as any,
        obd_snapshot: obdData as any,
        scanned_at: new Date().toISOString(),
      });
    },
  });

  const handleScan = async () => {
    setScanning(true);
    await scanDTCs();
    setScanning(false);
    if (dtcCodes.length > 0) {
      await saveDiag.mutateAsync();
      toast({ title: `${dtcCodes.length} fault code${dtcCodes.length > 1 ? "s" : ""} found`, description: "Ask your AI concierge for diagnosis" });
    } else {
      toast({ title: "All clear", description: "No fault codes detected" });
    }
  };

  const handleClear = async () => {
    await clearDTCs();
    toast({ title: "Codes cleared" });
  };

  const activeDTCs = dtcCodes.length > 0 ? dtcCodes : (lastDiag?.[0]?.dtc_codes as any[] ?? []);

  return (
    <AppLayout>
      <div className="px-4 pt-6 pb-4">
        <h1 className="font-bold text-xl mb-6">Garage</h1>

        {/* OBD-II Connection */}
        <div className="bg-card rounded-xl p-4 border border-border mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Bluetooth className={`h-5 w-5 ${obdStatus === "connected" ? "text-smooth" : "text-muted-foreground"}`} />
              <div>
                <div className="text-sm font-medium">OBD-II Scanner</div>
                <div className={`text-xs ${obdStatus === "connected" ? "text-smooth" : "text-muted-foreground"}`}>
                  {obdStatus === "connecting" ? "Connecting…" :
                   obdStatus === "connected" ? "Connected" :
                   obdStatus === "error" ? error ?? "Error" : "Disconnected"}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant={obdStatus === "connected" ? "outline" : "default"}
              onClick={obdStatus === "connected" ? disconnect : connect}
            >
              {obdStatus === "connected" ? "Disconnect" : "Connect"}
            </Button>
          </div>

          {/* Live PIDs */}
          {obdStatus === "connected" && (
            <div className="grid grid-cols-4 gap-2 mt-2">
              {[
                { label: "rpm", value: Math.round(obdData.rpm ?? 0) },
                { label: "mph", value: obdData.speed ? Math.round(obdData.speed * 0.621) : "--" },
                { label: "cool°F", value: obdData.coolantTemp ? Math.round(obdData.coolantTemp * 9/5 + 32) : "--" },
                { label: "fuel%", value: obdData.fuelLevel ? Math.round(obdData.fuelLevel) : "--" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-secondary rounded-lg p-2 text-center">
                  <div className="text-sm font-bold tabular-nums">{value}</div>
                  <div className="text-[10px] text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Scan actions */}
        <div className="flex gap-2 mb-6">
          <Button
            className="flex-1"
            disabled={obdStatus !== "connected" || scanning}
            onClick={handleScan}
          >
            <ScanLine className="h-4 w-4 mr-2" />
            {scanning ? "Scanning…" : "Scan for faults"}
          </Button>
          {dtcCodes.length > 0 && (
            <Button variant="outline" size="icon" onClick={handleClear}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* DTC results */}
        {activeDTCs.length > 0 ? (
          <div className="space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">Fault codes</h2>
              <button
                onClick={() => navigate("/concierge")}
                className="text-xs text-smooth flex items-center gap-1"
              >
                <Mic className="h-3 w-3" />
                Ask AI concierge
              </button>
            </div>
            {activeDTCs.map((dtc: any) => (
              <DTCCard key={dtc.code} dtc={dtc} />
            ))}
          </div>
        ) : (
          <div className="bg-card rounded-xl p-8 border border-border text-center">
            {obdStatus === "connected" ? (
              <>
                <ThumbsUp className="h-8 w-8 text-smooth mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No fault codes. Looking good!</p>
              </>
            ) : (
              <>
                <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Connect your OBD-II dongle to scan for fault codes
                </p>
              </>
            )}
          </div>
        )}

        {/* Scan history */}
        {lastDiag && lastDiag.length > 0 && (
          <div className="mt-6">
            <h2 className="font-semibold text-sm mb-3">Scan history</h2>
            {lastDiag.map((d: any) => {
              const codes = (d.dtc_codes as any[]) ?? [];
              return (
                <div key={d.id} className="bg-card rounded-xl p-3 border border-border mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm">{new Date(d.scanned_at).toLocaleDateString()}</div>
                    <div className={`text-xs ${codes.length > 0 ? "text-caution" : "text-smooth"}`}>
                      {codes.length > 0 ? `${codes.length} fault code${codes.length > 1 ? "s" : ""}` : "All clear"}
                    </div>
                  </div>
                  {codes.length === 0 && <ThumbsUp className="h-4 w-4 text-smooth" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
