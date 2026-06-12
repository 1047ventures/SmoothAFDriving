import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLATFORM_FEE_PERCENT = 0.12;

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-ESCROW-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
    logStep("Stripe key verified");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id });

    // Parse request body
    const { offerId, wantId } = await req.json();
    if (!offerId || !wantId) throw new Error("Missing offerId or wantId");
    logStep("Request parsed", { offerId, wantId });

    // Fetch offer details
    const { data: offer, error: offerError } = await supabaseClient
      .from("offers")
      .select("*, wants(title, user_id)")
      .eq("id", offerId)
      .single();

    if (offerError || !offer) throw new Error("Offer not found");
    logStep("Offer fetched", { askingPrice: offer.asking_price });

    // Verify user is the want owner (buyer)
    if (offer.wants.user_id !== user.id) {
      throw new Error("Only the want owner can initiate payment");
    }

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer exists
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    }
    logStep("Customer lookup", { customerId: customerId || "new customer" });

    // Calculate amounts in cents
    const itemAmountCents = Math.round(offer.asking_price * 100);
    const platformFeeCents = Math.round(offer.asking_price * PLATFORM_FEE_PERCENT * 100);
    const totalCents = itemAmountCents + platformFeeCents;
    logStep("Fee calculation", { itemAmountCents, platformFeeCents, totalCents });

    // Create checkout session with payment_intent_data for escrow-style hold
    const origin = req.headers.get("origin") || "http://localhost:8080";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: offer.wants.title,
              description: "Thrift find via ReverseThrift — held in escrow until delivery",
            },
            unit_amount: itemAmountCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Platform Service Fee (12%)",
              description: "Secure escrow, buyer protection & platform support",
            },
            unit_amount: platformFeeCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      payment_intent_data: {
        capture_method: "manual", // Hold funds, don't capture immediately (escrow style)
        metadata: {
          offer_id: offerId,
          want_id: wantId,
          buyer_id: user.id,
          thrifter_id: offer.thrifter_id,
          item_amount_cents: itemAmountCents.toString(),
          platform_fee_cents: platformFeeCents.toString(),
        },
      },
      metadata: {
        offer_id: offerId,
        want_id: wantId,
        platform_fee_cents: platformFeeCents.toString(),
      },
      success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}&offer_id=${offerId}`,
      cancel_url: `${origin}/want/${wantId}?payment=cancelled`,
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url, totalCents });

    return new Response(
      JSON.stringify({
        url: session.url,
        sessionId: session.id,
        itemAmount: offer.asking_price,
        platformFee: platformFeeCents / 100,
        total: totalCents / 100,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
