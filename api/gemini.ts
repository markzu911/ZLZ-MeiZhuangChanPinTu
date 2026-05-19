import { getGemini, corsHeaders, verifyBeforeGenerate, saveResultImageToSaas } from "./_utils";

export const config = {
  // Use Node.js runtime for Buffer support and longer timeouts if needed
  // runtime: 'edge', 
};

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY is not configured in Vercel' }, { status: 500 });
    }

    const body = await req.json();
    const { prompt, config: genConfig, productImage, referenceImage, userId, toolId } = body;

    const ai = getGemini(apiKey);

    if (userId && toolId) {
      await verifyBeforeGenerate({ userId, toolId });
    }

    const contentsParts: any[] = [{ text: prompt }];
    if (referenceImage) {
      const refData = referenceImage.includes(',') ? referenceImage.split(',')[1] : referenceImage;
      contentsParts.push({ inlineData: { data: refData, mimeType: "image/jpeg" } });
    }
    if (productImage) {
      const prodData = productImage.includes(',') ? productImage.split(',')[1] : productImage;
      contentsParts.push({ inlineData: { data: prodData, mimeType: "image/jpeg" } });
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
      },
    });

    let imageData = "";
    const parts = response.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      // Skip thinking/thought parts if present
      if ((part as any).thought) {
        continue;
      }

      if (part.inlineData?.data) {
        imageData = part.inlineData.data;
        break;
      }
    }

    if (!imageData) {
      const text = parts
        .map((part: any) => part.text)
        .filter(Boolean)
        .join("\n");

      return Response.json({ 
        error: "Gemini did not return an image",
        detail: text || "No image data returned from model"
      }, { 
        status: 502,
        headers: corsHeaders() 
      });
    }

    const binaryData = Buffer.from(imageData, 'base64');
    const base64Url = `data:image/png;base64,${imageData}`;

    if (userId && toolId) {
      try {
        const saasImage = await saveResultImageToSaas({
          userId,
          toolId,
          imageBuffer: binaryData,
          mimeType: 'image/png',
          fileName: `beauty-gen-${Date.now()}.png`
        });
        return Response.json({ 
          imageUrl: saasImage.url, 
          recordId: saasImage.recordId, 
          saasInfo: saasImage 
        }, { headers: corsHeaders() });
      } catch (saasError: any) {
        console.error("SaaS Save Error:", saasError);
        return Response.json({ 
          error: "Image generated but failed to save to SaaS storage", 
          detail: saasError?.message || String(saasError)
        }, { 
          status: 502,
          headers: corsHeaders() 
        });
      }
    }

    return Response.json({ imageUrl: base64Url }, { headers: corsHeaders() });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return Response.json({ error: error.message || "Generation failed" }, {
      status: 500,
      headers: corsHeaders()
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
