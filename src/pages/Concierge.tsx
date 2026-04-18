import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useVapi } from "@/hooks/useVapi";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Phone, PhoneOff, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Concierge() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { callStatus, messages, isSpeaking, transcript, startCall, endCall, configured } = useVapi();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, transcript]);

  return (
    <AppLayout>
      <div className="flex flex-col h-screen px-4 pt-6 pb-24">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-bold text-xl">AI Concierge</h1>
            <p className="text-xs text-muted-foreground">Your personal vehicle advisor</p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => navigate("/settings")}>
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        {!configured ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
              <Mic className="h-10 w-10 text-muted-foreground" />
            </div>
            <h2 className="font-semibold">Concierge not configured</h2>
            <p className="text-sm text-muted-foreground max-w-xs">
              Add your Vapi public key and assistant ID to <code className="text-xs bg-secondary px-1 rounded">.env</code> to enable voice AI.
            </p>
            <div className="bg-card rounded-xl p-4 border border-border text-left text-xs font-mono text-muted-foreground w-full max-w-xs">
              <div>VITE_VAPI_PUBLIC_KEY=pk_…</div>
              <div>VITE_VAPI_ASSISTANT_ID=asst_…</div>
            </div>
            <Button variant="outline" onClick={() => navigate("/settings")}>
              Go to Settings
            </Button>
          </div>
        ) : (
          <>
            {/* Status orb */}
            <div className="flex flex-col items-center py-6">
              <div className={cn(
                "relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300",
                callStatus === "active" && isSpeaking
                  ? "bg-smooth/20 glow-smooth"
                  : callStatus === "active"
                  ? "bg-smooth/10 border-2 border-smooth"
                  : "bg-card border-2 border-border"
              )}>
                {callStatus === "active" && isSpeaking && (
                  <div className="absolute inset-0 rounded-full bg-smooth/20 animate-ping" />
                )}
                <Mic className={cn("h-10 w-10", callStatus === "active" ? "text-smooth" : "text-muted-foreground")} />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                {callStatus === "idle" && "Tap to talk to your concierge"}
                {callStatus === "connecting" && "Connecting…"}
                {callStatus === "active" && (isSpeaking ? "Speaking…" : "Listening…")}
                {callStatus === "ending" && "Ending call…"}
              </p>
            </div>

            {/* Conversation */}
            <div className="flex-1 overflow-y-auto space-y-3 mb-4">
              {messages.length === 0 && callStatus === "idle" && (
                <div className="text-center py-8">
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Ask me anything about your car:</p>
                    <p>"What does code P0420 mean for my car?"</p>
                    <p>"How much would it cost to fix a misfire?"</p>
                    <p>"When should I change my oil?"</p>
                    <p>"Why is my check engine light on?"</p>
                  </div>
                </div>
              )}
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                    msg.role === "user"
                      ? "ml-auto bg-smooth text-background rounded-br-sm"
                      : "bg-card border border-border rounded-bl-sm"
                  )}
                >
                  {msg.content}
                </div>
              ))}
              {transcript && (
                <div className="max-w-[85%] ml-auto bg-smooth/20 border border-smooth/30 rounded-2xl rounded-br-sm px-4 py-3 text-sm text-smooth">
                  {transcript}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Call button */}
            <div className="flex justify-center">
              {callStatus === "idle" ? (
                <Button
                  onClick={() => startCall()}
                  className="w-16 h-16 rounded-full bg-smooth text-background glow-smooth"
                  size="icon"
                >
                  <Phone className="h-7 w-7" />
                </Button>
              ) : (
                <Button
                  onClick={endCall}
                  className="w-16 h-16 rounded-full bg-alert/20 border-2 border-alert text-alert"
                  size="icon"
                  variant="outline"
                >
                  <PhoneOff className="h-7 w-7" />
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
