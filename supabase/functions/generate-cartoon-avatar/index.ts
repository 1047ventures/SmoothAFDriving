import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const requestSchema = z.object({
  imageBase64: z.string().min(1, "Image data is required"),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).default("image/jpeg"),
});

const CARTOON_STYLES = [
  "Transform this photo into a bold comic-book cartoon avatar. Use thick outlines, vivid flat colors, and a fun superhero aesthetic. Keep the person's key features (hair, beard, clothing colors) recognizable but stylized.",
  "Reimagine this photo as an animated movie character portrait. Smooth cel-shaded style, expressive eyes, warm color palette, clean lines. Make it look like a Pixar or DreamWorks character profile pic.",
  "Convert this photo into a stylish street-art / graffiti-inspired cartoon portrait. Bold shapes, vibrant urban color palette, slightly edgy and cool aesthetic. Great as a social media profile picture.",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawBody = await req.json();
    const parseResult = requestSchema.safeParse(rawBody);

    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors[0]?.message || "Invalid input";
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { imageBase64, mimeType } = parseResult.data;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating 3 cartoon avatars for user:", user.id);

    const imagePromises = CARTOON_STYLES.map(async (stylePrompt, index) => {
      console.log(`Generating cartoon style ${index + 1}`);

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image-preview",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:${mimeType};base64,${imageBase64}` },
                },
                {
                  type: "text",
                  text: stylePrompt,
                },
              ],
            },
          ],
          modalities: ["image", "text"],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Cartoon generation ${index + 1} failed:`, response.status, errorText);

        if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again in a moment.");
        }
        if (response.status === 402) {
          throw new Error("AI credits exhausted. Please add credits to continue.");
        }
        throw new Error(`Image generation failed: ${response.status}`);
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

      if (!imageUrl) {
        console.error(`No image URL in response ${index + 1}:`, JSON.stringify(data));
        return null;
      }

      console.log(`Cartoon style ${index + 1} generated successfully`);
      return imageUrl;
    });

    const images = await Promise.all(imagePromises);
    const validImages = images.filter(Boolean);

    console.log(`Generated ${validImages.length} cartoon avatars`);

    return new Response(
      JSON.stringify({ images: validImages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error generating cartoon avatars:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to generate cartoon avatars" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
