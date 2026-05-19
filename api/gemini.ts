import { getGemini, corsHeaders, verifyBeforeGenerate, saveResultImageToSaas } from "./_utils";

export const config = {
  // We use standard runtime here due to Buffer usage in some logic if needed, 
  // but Edge also works if we use Uint8Array. 
  // Image generation might take time, so we'll stick to 'edge' if it supports the timeouts we need, 
  // or default to Node. Let's try Node for more reliability with binary data.
  // runtime: 'edge', 
};

export default {
  async fetch(req: Request) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

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
        contents: { parts: contentsParts },
        config: {
          // @ts-ignore
          imageConfig: genConfig,
        },
      });

      let imageData = "";
      if (response.candidates?.[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            imageData = part.inlineData.data;
            break;
          }
        }
      }

      if (!imageData) {
        return Response.json({ text: response.text }, { headers: corsHeaders() });
      }

      const binaryData = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));
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
          return Response.json({ 
            imageUrl: base64Url, 
            saasError: saasError.message 
          }, { headers: corsHeaders() });
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
};
