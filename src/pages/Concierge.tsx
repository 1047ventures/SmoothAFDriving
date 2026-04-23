import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useVapi } from "@/hooks/useVapi";
import { supabaseConfigured } from "@/integrations/supabase/client";
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
    if (!user && supabaseConfigured) navigate("/auth");
  }, [user, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isActive = callStatus === "active";

  return (
    <AppLayout>
      <div className="px-4 pt-6 pb-4 flex flex-col h-full">
        <h1 className="font-bold text-xl mb-1">AI Concierge</h1>
        <p className="text-xs text-muted-foreground mb-6">Ask anything about your car</p>

        {/* Orb */}
        <div className="flex justify-center mb-6">
          <div className={cn(
            "w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500",
            isActive
              ? "bg-smooth/20 shadow-[0_0_60px_hsl(142_69%_58%/0.4)] scale-110"
              : "bg-secondary"
          )}>
            {isActive
              ? <Mic className={cn("h-12 w-12 text-smooth", isSpeaking && "animate-score-pulse")} />
              : <MicOff className="h-12 w-12 text-muted-foreground" />
            }
          </div>
        </div>

        {/* Live transcript */}
        {isActive && transcript && (
          <div className="bg-secondary/50 rounded-xl p-3 mb-4 text-sm text-muted-foreground italic">
            {transcript}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-0">
          {messages.length === 0 && !isActive && (
            <div className="text-center text-muted-foreground text-sm pt-8">
              <p>Tap the button below to start talking.</p>
              <p className="text-xs mt-1">Ask about DTCs, maintenance, repairs, anything.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={cn(
              "rounded-xl px-3 py-2 text-sm max-w-[85%]",
              msg.role === "user" ? "ml-auto bg-smooth/20 text-foreground" : "bg-card border border-border"
            )}>
              {msg.content}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {!configured && (
          <div className="bg-secondary/50 rounded-xl p-3 mb-4 text-xs text-muted-foreground text-center">
            Vapi not configured. Add VITE_VAPI_PUBLIC_KEY + VITE_VAPI_ASSISTANT_ID to enable voice.
          </div>
        )}

        <Button
          onClick={isActive ? endCall : startCall}
          disabled={!configured}
          className={cn(
            "w-full font-bold rounded-xl py-6 text-base",
            isActive ? "border-alert text-alert" : "bg-smooth text-background glow-smooth"
          )}
          variant={isActive ? "outline" : "default"}
        >
          {isActive
            ? <><PhoneOff className="mr-2 h-5 w-5" /> End call</>
            : <><Phone className="mr-2 h-5 w-5" /> Start call</>
          }
        </Button>
      </div>
    </AppLayout>
  );
}
