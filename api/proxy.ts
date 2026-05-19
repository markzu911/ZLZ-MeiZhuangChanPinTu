import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SAAS_ORIGIN, saasFetch, corsHeaders, verifyBeforeGenerate, saveResultImageToSaas } from "./_utils.js";

export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    // 1. Analyze Route
    if (path === "/api/analyze") {
      return await handleAnalyze(req, res);
    }

    // 2. Gemini Route
    if (path === "/api/gemini") {
      return await handleGemini(req, res);
    }

    // 3. SaaS Proxy Routes (tool, upload, etc)
    if (path.startsWith("/api/tool/") || path.startsWith("/api/upload/")) {
      return await handleSaasProxy(req, res, path);
    }

    return res.status(404).json({ error: `Not Found: ${path}` });
  } catch (error: any) {
    console.error("Proxy Error:", error);
    return res.status(500).json({
      error: "Internal Proxy Error",
      detail: error.message || String(error)
    });
  }
}

async function handleAnalyze(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

  const { image } = req.body || {};
  if (!image) return res.status(400).json({ error: 'Image required' });

  const imageData = image.includes(',') ? image.split(',')[1] : image;
  const modelName = "gemini-1.5-flash-latest";
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{
      parts: [
        { text: "Analyze this beauty e-commerce reference image. 1. Identify the 'Main Product Subject' that should be replaced. 2. List all other 'Environment Elements' (background, props, lighting, model). Format the output as JSON: { \"mainSubject\": \"string\", \"environment\": [\"string\", \"string\"] }" },
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
    const detail = await geminiRes.text();
    return res.status(geminiRes.status).json({ error: "Gemini Analysis REST Error", detail, status: geminiRes.status });
  }

  const responseData = await geminiRes.json();
  const text = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let result = { mainSubject: "product", environment: ["beauty setting"] };
  if (jsonMatch) {
    try { result = JSON.parse(jsonMatch[0]); } catch (e) {}
  }
  return res.status(200).json(result);
}

async function handleGemini(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

  const { prompt, config, productImage, referenceImage, userId, toolId } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  if (userId && toolId) {
    try { await verifyBeforeGenerate({ userId, toolId }); } catch (e: any) {
      if (e.message === 'SaaS HTTPS certificate mismatch') return res.status(502).json({ error: e.message, detail: (e as any).detail });
      throw e;
    }
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

  const payload = {
    contents: [{ parts: contentsParts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      responseFormat: {
        image: {
          aspectRatio: config?.aspectRatio || "1:1",
          imageSize: config?.imageSize || "1K"
        }
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
    try { const ej = JSON.parse(errText); detail = ej.error?.message || ej.message || errText; } catch (e) {}
    return res.status(geminiRes.status).json({ error: "Gemini Generation REST Error", detail, status: geminiRes.status });
  }

  const responseData = await geminiRes.json();
  const parts = responseData.candidates?.[0]?.content?.parts || [];
  let imageData = "";
  for (const part of parts) {
    if (part.thought) continue;
    if (part.inlineData?.data) { imageData = part.inlineData.data; break; }
  }

  if (!imageData) {
    const t = parts.map((p: any) => p.text).filter(Boolean).join("\n");
    return res.status(502).json({ error: "Gemini did not return an image", detail: t || "No image data" });
  }

  const binaryData = Buffer.from(imageData, "base64");

  if (userId && toolId) {
    try {
      const saasImage = await saveResultImageToSaas({
        userId, toolId, imageBuffer: binaryData,
        mimeType: "image/png", fileName: `beauty-gen-${Date.now()}.png`
      });
      return res.status(200).json({ imageUrl: saasImage.url, recordId: saasImage.recordId, saasInfo: saasImage });
    } catch (e: any) {
      if (e.message === 'SaaS HTTPS certificate mismatch') return res.status(502).json({ error: e.message, detail: (e as any).detail });
      return res.status(502).json({ error: "Image generated but failed to save to SaaS", detail: e.message || String(e) });
    }
  }

  return res.status(200).json({ imageUrl: `data:image/png;base64,${imageData}` });
}

async function handleSaasProxy(req: VercelRequest, res: VercelResponse, path: string) {
  try {
    const saasRes = await saasFetch(`${SAAS_ORIGIN}${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {})
    });
    
    const text = await saasRes.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text.slice(0, 300) }; }

    if (!saasRes.ok || data.success === false) {
      return res.status(saasRes.status).json(data);
    }
    return res.status(200).json(data);
  } catch (error: any) {
    if (error.message === 'SaaS HTTPS certificate mismatch') {
      return res.status(502).json({ error: error.message, detail: error.detail });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
}
