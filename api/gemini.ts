import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getGemini, corsHeaders, verifyBeforeGenerate, saveResultImageToSaas } from "./_utils.js";

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
      return res.status(500).json({
        error: "GEMINI_API_KEY is not configured in Vercel"
      });
    }

    const body = req.body || {};
    const {
      prompt,
      config: genConfig,
      productImage,
      referenceImage,
      userId,
      toolId
    } = body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const ai = getGemini(apiKey);

    if (userId && toolId) {
      await verifyBeforeGenerate({ userId, toolId });
    }

    const contentsParts: any[] = [{ text: prompt }];

    if (referenceImage) {
      const refData = referenceImage.includes(",")
        ? referenceImage.split(",")[1]
        : referenceImage;

      contentsParts.push({
        inlineData: {
          data: refData,
          mimeType: "image/jpeg"
        }
      });
    }

    if (productImage) {
      const prodData = productImage.includes(",")
        ? productImage.split(",")[1]
        : productImage;

      contentsParts.push({
        inlineData: {
          data: prodData,
          mimeType: "image/jpeg"
        }
      });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: contentsParts,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        // @ts-ignore
        responseFormat: {
          image: {
            aspectRatio: genConfig?.aspectRatio || "1:1",
            imageSize: genConfig?.imageSize || "1K"
          }
        }
      }
    });

    let imageData = "";
    const parts = response.candidates?.[0]?.content?.parts || [];

    for (const part of parts as any[]) {
      if (part.thought) continue;

      if (part.inlineData?.data) {
        imageData = part.inlineData.data;
        break;
      }
    }

    if (!imageData) {
      const text = (parts as any[])
        .map((part) => part.text)
        .filter(Boolean)
        .join("\n");

      return res.status(502).json({
        error: "Gemini did not return an image",
        detail: text || "No image data returned from model"
      });
    }

    const binaryData = Buffer.from(imageData, "base64");

    if (userId && toolId) {
      try {
        const saasImage = await saveResultImageToSaas({
          userId,
          toolId,
          imageBuffer: binaryData,
          mimeType: "image/png",
          fileName: `beauty-gen-${Date.now()}.png`
        });

        return res.status(200).json({
          imageUrl: saasImage.url,
          recordId: saasImage.recordId,
          saasInfo: saasImage
        });
      } catch (saasError: any) {
        console.error("SaaS Save Error:", saasError);

        return res.status(502).json({
          error: "Image generated but failed to save to SaaS storage",
          detail: saasError?.message || String(saasError)
        });
      }
    }

    return res.status(200).json({
      imageUrl: `data:image/png;base64,${imageData}`
    });
  } catch (error: any) {
    console.error("Gemini API Error:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      cause: error?.cause
    });

    return res.status(500).json({
      error: "Generation failed",
      detail: error?.message || String(error)
    });
  }
}
