import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Want image generation (existing)
const wantRequestSchema = z.object({
  title: z.string()
    .min(3, 'Title must be at least 3 characters')
    .max(100, 'Title must not exceed 100 characters'),
  description: z.string()
    .max(500, 'Description must not exceed 500 characters')
    .optional()
    .nullable(),
});

// Cartoon avatar generation (new mode)
const cartoonRequestSchema = z.object({
  mode: z.literal('cartoon_avatar'),
  imageBase64: z.string().min(1, 'Image data is required'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
});

const CARTOON_STYLES = [
  "Transform this photo into a bold comic-book cartoon avatar. Use thick outlines, vivid flat colors, and a fun superhero aesthetic. Keep the person's key features (hair, beard, clothing colors) recognizable but stylized. Square crop, profile picture format.",
  "Reimagine this photo as an animated movie character portrait. Smooth cel-shaded style, expressive eyes, warm color palette, clean lines — like a Pixar or DreamWorks character. Square crop, profile picture format.",
  "Convert this photo into a stylish street-art / graffiti-inspired cartoon portrait. Bold shapes, vibrant urban color palette, slightly edgy and cool. Square crop, great as a social media profile picture.",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("LOVABLE_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rawBody = await req.json();

    // ── Cartoon avatar mode ────────────────────────────────────────────────
    if (rawBody?.mode === 'cartoon_avatar') {
      const parseResult = cartoonRequestSchema.safeParse(rawBody);
      if (!parseResult.success) {
        return new Response(
          JSON.stringify({ error: parseResult.error.errors[0]?.message || "Invalid input" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { imageBase64, mimeType } = parseResult.data;
      console.log("Generating cartoon avatars for user:", user.id);

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
                  { type: "text", text: stylePrompt },
                ],
              },
            ],
            modalities: ["image", "text"],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Cartoon ${index + 1} failed:`, response.status, errorText);
          if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
          if (response.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
          throw new Error(`Image generation failed: ${response.status}`);
        }

        const data = await response.json();
        const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
        if (!imageUrl) {
          console.error(`No image URL in cartoon response ${index + 1}:`, JSON.stringify(data));
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
    }

    // ── Want image mode (original) ─────────────────────────────────────────
    const parseResult = wantRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.errors[0]?.message || "Invalid input";
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { title, description } = parseResult.data;
    console.log("Generating images for:", title);

    const imagePromises = Array(3).fill(null).map(async (_, index) => {
      const detailsText = description ? ` Additional details: ${description}.` : '';
      const prompt = `Professional product photo of a ${title}.${detailsText} Clean white background, studio lighting, fashion e-commerce style, high quality, detailed. Variation ${index + 1}.`;

      console.log(`Generating image ${index + 1} with prompt:`, prompt);

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-image-preview",
          messages: [{ role: "user", content: prompt }],
          modalities: ["image", "text"],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Image generation ${index + 1} failed:`, response.status, errorText);
        if (response.status === 429) throw new Error("Rate limit exceeded. Please try again in a moment.");
        if (response.status === 402) throw new Error("AI credits exhausted. Please add credits to continue.");
        throw new Error(`Image generation failed: ${response.status}`);
      }

      const data = await response.json();
      const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

      if (!imageUrl) {
        console.error(`No image URL in response ${index + 1}:`, JSON.stringify(data));
        return null;
      }

      console.log(`Image ${index + 1} generated successfully`);
      return imageUrl;
    });

    const images = await Promise.all(imagePromises);
    const validImages = images.filter(Boolean);
    console.log(`Generated ${validImages.length} valid images`);

    return new Response(
      JSON.stringify({ images: validImages }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error generating images:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to generate images" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
