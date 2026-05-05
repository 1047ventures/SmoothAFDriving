/**
 * Smooth AF — one-time vehicle image generator.
 * Uses Google Gemini image generation (Nano Banana model).
 *
 * Usage:
 *   GEMINI_API_KEY=your_key_here node generate-vehicles.js
 *
 * Get a free key (1,500 requests/day) at:
 *   https://aistudio.google.com/app/apikey
 *
 * Saves 8 JPEG files to ./vehicles/*.jpg
 */

const { GoogleGenAI } = require('@google/genai');
const fs   = require('fs');
const path = require('path');

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('❌  Set GEMINI_API_KEY=your_key and re-run');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: KEY });

const VEHICLES = [
  { id: 'sedan',
    label: 'Sedan',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Sleek modern black luxury sedan on a wet city street at night. Dramatic rim lighting, moody dark atmosphere, deep shadows. Professional car photography style, 8K photorealistic.' },

  { id: 'crossover',
    label: 'Crossover',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Dark grey modern crossover SUV on a winding mountain road at golden hour. Dramatic side lighting, breathtaking backdrop. Professional car photography style, 8K photorealistic.' },

  { id: 'suv',
    label: 'Full-size SUV',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Massive black luxury full-size SUV on a vast desert highway at dusk. Dramatic undercar lighting, imposing and powerful presence. Professional car photography, 8K photorealistic.' },

  { id: 'sports',
    label: 'Sports Car',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Dark red sports coupe on a racetrack at night. Dramatic rim lighting, motion blur in the background, raw energy. Professional automotive photography, 8K photorealistic.' },

  { id: 'convertible',
    label: 'Convertible',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Silver luxury convertible on a coastal cliff road at golden hour. Breathtaking ocean backdrop, dramatic warm lighting. Professional car photography, 8K photorealistic.' },

  { id: 'truck',
    label: 'Pickup Truck',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Black lifted pickup truck on a rugged mountain trail at dusk. Dramatic storm clouds, powerful and aggressive stance. Professional automotive photography, 8K photorealistic.' },

  { id: 'hatchback',
    label: 'Hatchback',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Dark hot hatchback on a wet European city street at night. Vivid neon reflections, urban energy. Professional automotive photography, 8K photorealistic.' },

  { id: 'electric',
    label: 'Electric',
    prompt: 'Ultra-cinematic low-angle automotive photograph. Sleek white electric car in a futuristic modern city at night. Dramatic blue accent lighting, clean and futuristic. Professional automotive photography, 8K photorealistic.' },
];

const OUT_DIR = path.join(__dirname, 'vehicles');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function generateOne(vehicle, index) {
  console.log(`[${index + 1}/${VEHICLES.length}] Generating ${vehicle.label}…`);
  const outPath = path.join(OUT_DIR, `${vehicle.id}.jpg`);

  // Skip if already exists
  if (fs.existsSync(outPath)) {
    console.log(`  ✓ Already exists, skipping.`);
    return;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-2.0-flash-preview-image-generation',
    contents: vehicle.prompt,
    config: {
      responseModalities: ['IMAGE'],
    },
  });

  const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part?.inlineData?.data) {
    throw new Error(`No image returned for ${vehicle.id}`);
  }

  const buf = Buffer.from(part.inlineData.data, 'base64');
  fs.writeFileSync(outPath, buf);
  console.log(`  ✓ Saved ${vehicle.id}.jpg (${(buf.length / 1024).toFixed(0)} KB)`);
}

(async () => {
  console.log('🚗  Smooth AF vehicle image generator\n');

  for (let i = 0; i < VEHICLES.length; i++) {
    try {
      await generateOne(VEHICLES[i], i);
    } catch (err) {
      console.error(`  ✗ ${VEHICLES[i].id}: ${err.message}`);
    }
    // Brief pause between requests to stay in rate limits
    if (i < VEHICLES.length - 1) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\n✅  Done! Commit the vehicles/ folder and deploy.');
})();
