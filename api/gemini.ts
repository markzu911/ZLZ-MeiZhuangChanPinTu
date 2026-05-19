import type { VercelRequest, VercelResponse } from "@vercel/node";
import { corsHeaders, verifyBeforeGenerate, saveResultImageToSaas } from "./_utils.js";

export const maxDuration = 120;

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
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel"
      });
    }

    const { prompt, config: genConfig, productImage, referenceImage, userId, toolId } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (userId && toolId) {
      await verifyBeforeGenerate({ userId, toolId });
    }

    const contentsParts: any[] = [{ text: prompt }];
    if (referenceImage) {
      const refData = referenceImage.includes(",") ? referenceImage.split(",")[1] : referenceImage;
      contentsParts.push({ inlineData: { data: refData, mimeType: "image/jpeg" } });
    }
    if (productImage) {
      const prodData = productImage.includes(",") ? productImage.split(",")[1] : productImage;
      contentsParts.push({ inlineData: { data: prodData, mimeType: "image/jpeg" } });
    }

    const modelName = "gemini-3.1-flash-image-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    // Capping imageSize to 2K for stability and avoiding 504
    let requestedSize = genConfig?.imageSize || "1K";
    if (requestedSize === "4K") {
      requestedSize = "2K";
    }

    const payload = {
      contents: [{ parts: contentsParts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: genConfig?.aspectRatio || "1:1",
          imageSize: requestedSize
        }
      }
    };

    const geminiRes = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      let detail = errText;
      try {
        const errJson = JSON.parse(errText);
        detail = errJson.error?.message || errJson.message || errText;
      } catch (e) {}
      
      return res.status(geminiRes.status).json({
        error: "Gemini REST API failed",
        detail: detail,
        status: geminiRes.status
      });
    }

    const responseData = await geminiRes.json();
    const parts = responseData.candidates?.[0]?.content?.parts || [];
    let imageData = "";

    for (const part of parts) {
      if (part.thought) continue;
      if (part.inlineData?.data) {
        imageData = part.inlineData.data;
        break;
      }
    }

    if (!imageData) {
      const text = parts.map((part: any) => part.text).filter(Boolean).join("\n");
      return res.status(502).json({
        error: "Gemini did not return an image",
        detail: text || "No image data returned from model REST API"
      });
    }

    return res.status(200).json({ imageUrl: `data:image/png;base64,${imageData}` });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return res.status(500).json({ error: "Generation failed", detail: error?.message || String(error) });
  }
}
