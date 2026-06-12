import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PAYMENT] ${step}${detailsStr}`);
};

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
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError) throw new Error(`Authentication error: ${userError.message}`);

    const user = userData.user;
    if (!user) throw new Error("User not authenticated");
    logStep("User authenticated", { userId: user.id });

    // Parse request body
    const { sessionId, offerId } = await req.json();
    if (!sessionId || !offerId) throw new Error("Missing sessionId or offerId");
    logStep("Request parsed", { sessionId, offerId });

    // Initialize Stripe and retrieve session
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent']
    });
    logStep("Session retrieved", {
      status: session.status,
      paymentStatus: session.payment_status,
      metadataOfferId: session.metadata?.offer_id
    });

    // Verify payment was successful
    if (session.payment_status !== 'paid') {
      throw new Error("Payment not completed");
    }

    // Verify session metadata matches the offer
    if (session.metadata?.offer_id !== offerId) {
      throw new Error("Session does not match offer");
    }

    // Fetch the offer to verify user is the want owner (buyer)
    const { data: offer, error: offerError } = await supabaseClient
      .from("offers")
      .select("*, wants(user_id, fulfillment)")
      .eq("id", offerId)
      .single();

    if (offerError || !offer) throw new Error("Offer not found");

    // Verify the authenticated user is the buyer (want owner)
    if (offer.wants.user_id !== user.id) {
      throw new Error("Only the buyer can verify payment");
    }

    logStep("Authorization verified", { wantOwner: offer.wants.user_id });

    // Update offer status to accepted
    const { error: updateOfferError } = await supabaseClient
      .from("offers")
      .update({ status: "accepted" })
      .eq("id", offerId);

    if (updateOfferError) throw new Error(`Failed to update offer: ${updateOfferError.message}`);
    logStep("Offer status updated to accepted");

    // Update want status to fulfilled
    const { error: updateWantError } = await supabaseClient
      .from("wants")
      .update({ status: "fulfilled" })
      .eq("id", offer.want_id);

    if (updateWantError) throw new Error(`Failed to update want: ${updateWantError.message}`);
    logStep("Want status updated to fulfilled");

    // Record the transaction with platform fee for earnings tracking
    const platformFeeCents = parseInt(session.metadata?.platform_fee_cents || '0');
    const platformFeeAmount = platformFeeCents / 100;

    const { error: transactionError } = await supabaseClient
      .from("transactions")
      .upsert(
        {
          offer_id: offerId,
          buyer_id: user.id,
          thrifter_id: offer.thrifter_id,
          amount: offer.asking_price,
          platform_fee_amount: platformFeeAmount,
          stripe_session_id: sessionId,
          fulfillment_method: offer.wants.fulfillment || "both",
          status: "paid",
        },
        { onConflict: "offer_id" }
      );

    if (transactionError) {
      logStep("WARNING: Failed to record transaction", { error: transactionError.message });
    } else {
      logStep("Transaction recorded", { amount: offer.asking_price, platformFeeAmount });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Payment verified and status updated",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
