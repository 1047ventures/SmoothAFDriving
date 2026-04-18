import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useEffect } from "react";
import { ChevronRight, Camera, Cpu, Navigation, Mic, Star, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const tiers = [
  {
    name: "Cam Kit",
    price: "$149",
    highlight: false,
    tag: null,
    description: "Standalone value. Most dash cams don't have a HUD.",
    features: [
      "1440p front dash cam",
      "1080p rear cam",
      "AR HUD windshield projector",
      "Smooth AF Driving app — trip scoring",
      "Cloud trip storage",
    ],
  },
  {
    name: "Pro",
    price: "$199",
    highlight: true,
    tag: "Most Popular",
    description: "Add full vehicle intelligence.",
    features: [
      "Everything in Cam Kit",
      "OBD-II Bluetooth dongle",
      "Real-time PIDs (speed, RPM, temp, fuel)",
      "DTC fault code scanner + AI diagnosis",
      "Repair cost estimates",
    ],
  },
  {
    name: "Elite",
    price: "$249 + $9.99/mo",
    highlight: false,
    tag: "Founder Rate",
    description: "Your full vehicle concierge.",
    features: [
      "Everything in Pro",
      "AI Voice Concierge (24/7)",
      "Proactive maintenance alerts",
      "Live traffic smooth-line routing",
      "Priority support",
    ],
  },
];

export default function Index() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/dashboard");
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-4 bg-background/80 backdrop-blur border-b border-border">
        <span className="font-bold tracking-tight text-lg">
          <span className="text-smooth">SMOOTH AF</span>DRIVING
        </span>
        <Button size="sm" variant="outline" onClick={() => navigate("/auth")}>
          Sign in
        </Button>
      </header>

      {/* Hero */}
      <section className="pt-28 pb-16 px-5 text-center">
        <div className="inline-flex items-center gap-2 bg-smooth/10 text-smooth text-xs rounded-full px-3 py-1 mb-6 border border-smooth/30">
          <Zap className="h-3 w-3" />
          Now in early access
        </div>
        <h1 className="text-4xl font-bold leading-tight mb-4">
          Drive like it
          <br />
          <span className="text-smooth">matters.</span>
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed max-w-sm mx-auto mb-8">
          Real-time AR guidance projected onto your windshield. OBD-II diagnostics. AI vehicle concierge.
          Everything you need to be a smoother driver and own your car better.
        </p>
        <Button
          className="bg-smooth text-background font-bold rounded-full px-8 py-3 text-base glow-smooth"
          onClick={() => navigate("/auth")}
        >
          Get early access <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </section>

      {/* Feature pills */}
      <section className="px-5 pb-12">
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: Navigation, label: "AR HUD", sub: "Smoothest line, live" },
            { icon: Camera, label: "Dual Cam", sub: "Front + rear 1440p" },
            { icon: Cpu, label: "OBD-II", sub: "Full diagnostics" },
            { icon: Mic, label: "AI Concierge", sub: "Ask anything" },
          ].map(({ icon: Icon, label, sub }) => (
            <div key={label} className="bg-card rounded-xl p-4 border border-border">
              <Icon className="h-6 w-6 text-smooth mb-2" />
              <div className="font-semibold text-sm">{label}</div>
              <div className="text-xs text-muted-foreground">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* HUD explanation */}
      <section className="px-5 pb-12">
        <h2 className="text-xl font-bold mb-3">The line that changes how you drive</h2>
        <p className="text-muted-foreground text-sm leading-relaxed mb-4">
          The AR HUD reads live camera feed + GPS and projects color-coded path guidance directly onto your windshield.
          Green means you're threading traffic perfectly. Yellow: tighten up. Red: you're creating friction for everyone.
        </p>
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          {[
            { color: "bg-smooth", label: "Green", desc: "Flow state — optimal line" },
            { color: "bg-caution", label: "Yellow", desc: "Adjust — smoother path available" },
            { color: "bg-alert", label: "Red", desc: "Friction zone — back off" },
          ].map(({ color, label, desc }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${color} flex-shrink-0`} />
              <span className="text-sm font-medium w-14">{label}</span>
              <span className="text-xs text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Tiers */}
      <section className="px-5 pb-16">
        <h2 className="text-xl font-bold mb-6 text-center">Pick your kit</h2>
        <div className="space-y-4">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-2xl border p-5 ${
                tier.highlight
                  ? "border-smooth bg-smooth/5 glow-smooth"
                  : "border-border bg-card"
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  {tier.tag && (
                    <span className={`text-xs rounded-full px-2 py-0.5 mb-1.5 inline-block ${
                      tier.highlight ? "bg-smooth text-background" : "bg-secondary text-muted-foreground"
                    }`}>
                      {tier.tag}
                    </span>
                  )}
                  <div className="font-bold text-lg">{tier.name}</div>
                  <div className="text-sm text-muted-foreground">{tier.description}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-lg">{tier.price}</div>
                </div>
              </div>
              <ul className="space-y-1.5">
                {tier.features.map(f => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <Star className="h-3 w-3 text-smooth flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                className={`w-full mt-4 rounded-full font-bold ${
                  tier.highlight
                    ? "bg-smooth text-background hover:bg-smooth/90"
                    : "bg-secondary text-foreground hover:bg-secondary/80"
                }`}
                onClick={() => navigate("/auth")}
              >
                Get started
              </Button>
            </div>
          ))}
        </div>
      </section>

      <footer className="px-5 pb-10 text-center text-xs text-muted-foreground">
        smoothafdriving.com — Drive like it matters
      </footer>
    </div>
  );
}
