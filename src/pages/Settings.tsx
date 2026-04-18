import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, Save, Car, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [fullName, setFullName] = useState("");
  const [carYear, setCarYear] = useState("");
  const [carMake, setCarMake] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carNickname, setCarNickname] = useState("");

  useEffect(() => {
    if (!user) navigate("/auth");
  }, [user, navigate]);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).single();
      return data;
    },
  });

  const { data: vehicle } = useQuery({
    queryKey: ["vehicle-primary", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("vehicles")
        .select("*")
        .eq("user_id", user!.id)
        .eq("is_primary", true)
        .single();
      return data;
    },
  });

  useEffect(() => {
    if (profile?.full_name) setFullName(profile.full_name);
  }, [profile]);

  useEffect(() => {
    if (vehicle) {
      setCarYear(String(vehicle.year ?? ""));
      setCarMake(vehicle.make ?? "");
      setCarModel(vehicle.model ?? "");
      setCarNickname(vehicle.nickname ?? "");
    }
  }, [vehicle]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      await supabase.from("profiles").upsert({ id: user!.id, full_name: fullName, updated_at: new Date().toISOString() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast({ title: "Profile saved" });
    },
  });

  const saveVehicle = useMutation({
    mutationFn: async () => {
      const payload = {
        user_id: user!.id,
        year: carYear ? parseInt(carYear) : null,
        make: carMake || null,
        model: carModel || null,
        nickname: carNickname || null,
        is_primary: true,
      };
      if (vehicle?.id) {
        await supabase.from("vehicles").update(payload).eq("id", vehicle.id);
      } else {
        await supabase.from("vehicles").insert(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-primary"] });
      toast({ title: "Vehicle saved" });
    },
  });

  return (
    <AppLayout>
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-3 mb-6">
          <Button size="icon" variant="ghost" onClick={() => navigate("/dashboard")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-bold text-xl">Settings</h1>
        </div>

        {/* Profile */}
        <div className="bg-card rounded-xl p-4 border border-border mb-4">
          <h2 className="font-semibold mb-4">Profile</h2>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Name</Label>
              <Input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Your name"
                className="bg-secondary border-0"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Email</Label>
              <Input value={user?.email ?? ""} disabled className="bg-secondary border-0 opacity-50" />
            </div>
          </div>
          <Button
            className="w-full mt-4 bg-smooth text-background"
            onClick={() => saveProfile.mutate()}
            disabled={saveProfile.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            Save profile
          </Button>
        </div>

        {/* Vehicle */}
        <div className="bg-card rounded-xl p-4 border border-border mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Car className="h-5 w-5 text-smooth" />
            <h2 className="font-semibold">My vehicle</h2>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Year</Label>
              <Input
                value={carYear}
                onChange={e => setCarYear(e.target.value)}
                placeholder="2020"
                type="number"
                className="bg-secondary border-0"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Make</Label>
              <Input
                value={carMake}
                onChange={e => setCarMake(e.target.value)}
                placeholder="Toyota"
                className="bg-secondary border-0"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Model</Label>
              <Input
                value={carModel}
                onChange={e => setCarModel(e.target.value)}
                placeholder="Camry"
                className="bg-secondary border-0"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Nickname</Label>
              <Input
                value={carNickname}
                onChange={e => setCarNickname(e.target.value)}
                placeholder="The Beast"
                className="bg-secondary border-0"
              />
            </div>
          </div>
          <Button
            className="w-full bg-smooth text-background"
            onClick={() => saveVehicle.mutate()}
            disabled={saveVehicle.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            Save vehicle
          </Button>
        </div>

        {/* Device pairing link */}
        <button
          onClick={() => navigate("/onboarding")}
          className="w-full bg-card rounded-xl p-4 border border-border flex items-center gap-3 mb-4"
        >
          <Plus className="h-5 w-5 text-smooth" />
          <div className="text-left">
            <div className="font-medium text-sm">Set up hardware devices</div>
            <div className="text-xs text-muted-foreground">Cam, OBD-II, HUD pairing guide</div>
          </div>
        </button>

        {/* Sign out */}
        <Button
          variant="outline"
          className="w-full border-alert/50 text-alert hover:bg-alert/10"
          onClick={signOut}
        >
          Sign out
        </Button>
      </div>
    </AppLayout>
  );
}
