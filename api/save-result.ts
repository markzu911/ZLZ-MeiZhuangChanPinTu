import type { VercelRequest, VercelResponse } from "@vercel/node";
import { corsHeaders, saveResultImageToSaas } from "./_utils.js";

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
    const { imageUrl, userId, toolId } = req.body || {};

    if (!imageUrl || !userId || !toolId) {
      return res.status(400).json({ error: "Missing required parameters: imageUrl, userId, toolId" });
    }

    // Convert base64 to Buffer if needed
    let imageBuffer: Buffer;
    if (imageUrl.startsWith('data:')) {
      const base64Data = imageUrl.split(',')[1];
      imageBuffer = Buffer.from(base64Data, 'base64');
    } else if (imageUrl.startsWith('http')) {
      const response = await fetch(imageUrl);
      const arrayBuffer = await response.arrayBuffer();
      imageBuffer = Buffer.from(arrayBuffer);
    } else {
      imageBuffer = Buffer.from(imageUrl, 'base64');
    }

    const saasImage = await saveResultImageToSaas({
      userId,
      toolId,
      imageBuffer,
      mimeType: "image/png",
      fileName: `beauty-gen-${Date.now()}.png`
    });

    return res.status(200).json({
      success: true,
      imageUrl: saasImage.url,
      recordId: saasImage.recordId,
      saasInfo: saasImage
    });
  } catch (error: any) {
    console.error("SaaS Save API Error:", error);
    return res.status(500).json({
      error: "Failed to save to SaaS",
      detail: error?.message || String(error)
    });
  }
}
