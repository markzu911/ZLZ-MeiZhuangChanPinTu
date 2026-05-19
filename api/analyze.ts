import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGemini, corsHeaders } from "./_utils.js";

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

    const body = req.body || {};
    const image = body.image;
    if (!image) {
      return res.status(400).json({ error: 'Image required' });
    }

    const ai = getGemini(apiKey);
    const imageData = image.includes(',') ? image.split(',')[1] : image;
    
    const response = await ai.models.generateContent({
      model: "gemini-flash-latest",
      contents: {
        parts: [
          { text: "Analyze this beauty e-commerce reference image. 1. Identify the 'Main Product Subject' that should be replaced. 2. List all other 'Environment Elements' (background, props, lighting, model). Format the output as JSON: { \"mainSubject\": \"string\", \"environment\": [\"string\", \"string\"] }" },
          { inlineData: { data: imageData, mimeType: "image/jpeg" } }
        ]
      },
    });
    
    const resultText = response.text || "{}";
    const jsonStart = resultText.indexOf('{');
    const jsonEnd = resultText.lastIndexOf('}') + 1;
    
    let result = { mainSubject: "product", environment: ["beauty setting"] };
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      try {
        result = JSON.parse(resultText.substring(jsonStart, jsonEnd));
      } catch (e) {}
    }

    return res.status(200).json(result);
  } catch (error: any) {
    console.error("Analyze API Error:", error);
    return res.status(500).json({ error: error.message || "Analysis failed" });
  }
}
