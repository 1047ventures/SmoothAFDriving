import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ADMIN_EMAIL = "skellyslife@gmail.com";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !userData.user) throw new Error("Authentication failed");

    if (userData.user.email !== ADMIN_EMAIL) {
      throw new Error("Unauthorized");
    }

    // Query all transactions using service role (bypasses RLS)
    const { data: transactions, error } = await supabaseClient
      .from("transactions")
      .select("amount, platform_fee_amount, status, created_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error(`Query failed: ${error.message}`);

    const paid = (transactions || []).filter((t) =>
      ["paid", "shipped", "completed"].includes(t.status)
    );

    const totalGmv = paid.reduce((sum, t) => sum + Number(t.amount), 0);
    const totalFees = paid.reduce((sum, t) => sum + Number(t.platform_fee_amount), 0);
    const transactionCount = paid.length;

    // Monthly breakdown (last 6 months)
    const monthlyMap: Record<string, { gmv: number; fees: number; count: number }> = {};
    for (const t of paid) {
      const month = t.created_at.slice(0, 7); // "YYYY-MM"
      if (!monthlyMap[month]) monthlyMap[month] = { gmv: 0, fees: 0, count: 0 };
      monthlyMap[month].gmv += Number(t.amount);
      monthlyMap[month].fees += Number(t.platform_fee_amount);
      monthlyMap[month].count += 1;
    }

    const monthly = Object.entries(monthlyMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 6)
      .map(([month, data]) => ({ month, ...data }));

    return new Response(
      JSON.stringify({ totalGmv, totalFees, transactionCount, monthly }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Unauthorized" ? 403 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status }
    );
  }
});
