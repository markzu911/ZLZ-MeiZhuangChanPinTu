import type { VercelRequest, VercelResponse } from "@vercel/node";
import { corsHeaders } from "./_utils.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in Vercel' });
    }

    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ error: 'Image required' });
    }

    const imageData = image.includes(',') ? image.split(',')[1] : image;
    
    // Use REST API for analyze
    const modelName = "gemini-3.1-flash-image-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [
          { text: "Analyze this beauty e-commerce reference image. 1. Identify the 'Main Product Subject' that should be replaced. 2. List all other 'Environment Elements' (background, props, lighting, model). Format the output as JSON: { \"mainSubject\": \"string\", \"environment\": [\"string\", \"string\"] }. Important: ALL string values in the JSON (both main subject and environment elements) MUST be translated into perfectly natural Chinese." },
          { inlineData: { data: imageData, mimeType: "image/jpeg" } }
        ]
      }]
    };

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(geminiRes.status).json({
        error: "Analysis failed via REST API",
        detail: errText,
        status: geminiRes.status
      });
    }

    const responseData = await geminiRes.json();
    const resultText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    
    let result = { mainSubject: "product", environment: ["beauty setting"] };
    if (jsonMatch) {
      try { result = JSON.parse(jsonMatch[0]); } catch (e) {}
    }

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Analyze API Error:", error);
    return res.status(500).json({ error: error.message || "Analysis failed" });
  }
}
