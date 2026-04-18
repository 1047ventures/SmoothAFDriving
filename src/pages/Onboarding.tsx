import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Camera, Cpu, Navigation, Bluetooth, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = [
  {
    id: "dash-cam",
    icon: Camera,
    title: "Mount the dash cam",
    subtitle: "Front camera + HUD projector unit",
    color: "text-smooth",
    instructions: [
      "Clean your windshield — top-center position, driver's side of rearview mirror",
      "Mount the Smooth AF Driving unit using the suction bracket or adhesive pad",
      "Connect the USB-C power cable to your car's USB port or 12V adapter",
      "Angle the camera downward ~10° to capture road + hood line",
      "The HUD projector faces toward the windshield — aim for the lower third of driver's view",
    ],
    note: "The projector works best with factory tinted windshields. Anti-glare film on untinted glass recommended.",
  },
  {
    id: "rear-cam",
    icon: Camera,
    title: "Mount the rear cam",
    subtitle: "Rear window or license plate position",
    color: "text-smooth",
    instructions: [
      "Mount inside rear window (top-center) using the suction cup, OR",
      "Use the license plate mount adapter (included) for external placement",
      "Route the included 5m cable along the headliner and down the door jamb trim",
      "Connect to the main unit via the micro-HDMI input (labeled 'REAR')",
      "Test the feed in the app → Settings → Camera Preview",
    ],
    note: "External license plate mount provides wider angle but requires weatherproof installation.",
  },
  {
    id: "obd2",
    icon: Cpu,
    title: "Plug in the OBD-II dongle",
    subtitle: "Under the dash, driver's side",
    color: "text-caution",
    instructions: [
      "Locate your OBD-II port — typically under the dash, left of steering column",
      "Most ports have a plastic cover; press the tab to remove",
      "Plug in the Smooth AF Driving OBD-II Bluetooth dongle firmly until it clicks",
      "The LED will flash blue — it's now pairing",
      "In the app → Garage → tap 'Connect' → select 'Smooth AF Driving OBD'",
    ],
    note: "Requires Bluetooth 4.0+. Works on all OBD-II compliant vehicles (US market 1996+).",
  },
  {
    id: "pair-hud",
    icon: Navigation,
    title: "Pair the HUD",
    subtitle: "AR windshield overlay",
    color: "text-smooth",
    instructions: [
      "Power on the car — the HUD projector will boot (Smooth AF Driving logo appears)",
      "Open the Smooth AF Driving app and go to Drive mode",
      "Tap 'Calibrate HUD' — the app shows a calibration grid",
      "Use the physical adjustment dial on the unit to align the grid with the road",
      "Once calibrated, the smooth-line overlay activates automatically when driving",
    ],
    note: "HUD brightness auto-adjusts for day/night. Manual override in Drive → HUD Settings.",
  },
  {
    id: "done",
    icon: CheckCircle,
    title: "You're all set",
    subtitle: "Go drive smoothly",
    color: "text-smooth",
    instructions: [
      "App scoring works independently — no hardware needed for score tracking",
      "OBD-II gives real-time engine data overlaid in Drive mode",
      "HUD projection activates when you hit 5 mph",
      "Ask your AI Concierge anything about your car anytime",
      "Your score improves with each trip as you learn the smooth line",
    ],
    note: "Questions? Your AI Concierge tab is always available. Drive like it matters.",
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  return (
    <div className="min-h-screen bg-background px-4 pt-6 pb-8 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Button size="icon" variant="ghost" onClick={() => step === 0 ? navigate("/settings") : setStep(s => s - 1)}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="font-bold text-xl">Device Setup</h1>
      </div>

      {/* Progress dots */}
      <div className="flex gap-1.5 mb-8 justify-center">
        {steps.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === step ? "w-6 bg-smooth" : "w-1.5 bg-border"
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 animate-fade-in">
        <div className="flex items-center gap-3 mb-2">
          <Icon className={cn("h-7 w-7", current.color)} />
          <div>
            <h2 className="font-bold text-xl">{current.title}</h2>
            <p className="text-sm text-muted-foreground">{current.subtitle}</p>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {current.instructions.map((instruction, i) => (
            <div key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-secondary text-xs flex items-center justify-center font-medium mt-0.5">
                {isLast ? <CheckCircle className="h-3.5 w-3.5 text-smooth" /> : i + 1}
              </span>
              <p className="text-sm leading-relaxed">{instruction}</p>
            </div>
          ))}
        </div>

        {current.note && (
          <div className="mt-6 bg-secondary/50 rounded-xl p-3 border border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="text-foreground font-medium">Note: </span>
              {current.note}
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-8">
        {isLast ? (
          <Button
            className="w-full bg-smooth text-background font-bold rounded-xl py-6 glow-smooth"
            onClick={() => navigate("/drive")}
          >
            Start first trip
          </Button>
        ) : (
          <Button
            className="w-full bg-smooth text-background font-bold rounded-xl py-6"
            onClick={() => setStep(s => s + 1)}
          >
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
