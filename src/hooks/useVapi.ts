import { useState, useRef, useCallback, useEffect } from "react";
import Vapi from "@vapi-ai/web";

export type CallStatus = "idle" | "connecting" | "active" | "ending";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY ?? "";
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID ?? "";

export function useVapi() {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const vapiRef = useRef<Vapi | null>(null);

  useEffect(() => {
    if (!VAPI_PUBLIC_KEY) return;
    vapiRef.current = new Vapi(VAPI_PUBLIC_KEY);
    const vapi = vapiRef.current;

    vapi.on("call-start", () => setCallStatus("active"));
    vapi.on("call-end", () => {
      setCallStatus("idle");
      setIsSpeaking(false);
      setTranscript("");
    });
    vapi.on("speech-start", () => setIsSpeaking(true));
    vapi.on("speech-end", () => setIsSpeaking(false));
    vapi.on("message", (msg: any) => {
      if (msg.type === "transcript") {
        if (msg.transcriptType === "partial") {
          setTranscript(msg.transcript);
        } else {
          setMessages(prev => [...prev, {
            role: msg.role,
            content: msg.transcript,
            timestamp: Date.now(),
          }]);
          setTranscript("");
        }
      }
    });
    vapi.on("error", () => setCallStatus("idle"));

    return () => { vapi.stop(); };
  }, []);

  const startCall = useCallback(async (contextMessage?: string) => {
    if (!vapiRef.current || !VAPI_ASSISTANT_ID) return;
    setCallStatus("connecting");
    setMessages([]);
    try {
      await vapiRef.current.start(VAPI_ASSISTANT_ID, {
        variableValues: contextMessage ? { context: contextMessage } : undefined,
      });
    } catch {
      setCallStatus("idle");
    }
  }, []);

  const endCall = useCallback(() => {
    vapiRef.current?.stop();
    setCallStatus("ending");
  }, []);

  const configured = Boolean(VAPI_PUBLIC_KEY && VAPI_ASSISTANT_ID);

  return { callStatus, messages, isSpeaking, transcript, startCall, endCall, configured };
}
