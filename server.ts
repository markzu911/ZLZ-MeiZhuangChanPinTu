import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const SAAS_ORIGIN = process.env.SAAS_ORIGIN || 'https://aibigtree.com';

async function readJsonResponse(res: Response) {
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 300) };
  }

  if (!res.ok || data.success === false) {
    throw new Error(data.error || data.message || `Request failed: ${res.status}`);
  }

  return data;
}

async function verifyBeforeGenerate({ userId, toolId }: { userId: string, toolId: string }) {
  if (!userId || !toolId) return null;
  const res = await fetch(`${SAAS_ORIGIN}/api/tool/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  });
  return readJsonResponse(res);
}

async function saveResultImageToSaas({
  userId,
  toolId,
  imageBuffer,
  mimeType = 'image/png',
  fileName = 'result.png'
}: {
  userId: string;
  toolId: string;
  imageBuffer: Buffer;
  mimeType?: string;
  fileName?: string;
}) {
  // Step 1: Consume points
  const consumeRes = await fetch(`${SAAS_ORIGIN}/api/tool/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  });
  await readJsonResponse(consumeRes);

  // Step 2: Get OSS upload token
  const tokenRes = await fetch(`${SAAS_ORIGIN}/api/upload/direct-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      mimeType,
      fileName,
      fileSize: imageBuffer.byteLength
    })
  });
  const token = await readJsonResponse(tokenRes);

  // Step 3: Direct upload to OSS
  const uploadRes = await fetch(token.uploadUrl, {
    method: token.method || 'PUT',
    headers: {
      ...token.headers,
      'Content-Type': mimeType // Ensure content type matches token
    },
    body: imageBuffer
  });
  
  if (!uploadRes.ok) {
    throw new Error(`OSS Upload failed: ${uploadRes.status}`);
  }

  // Step 4: Commit record to SaaS
  const commitRes = await fetch(`${SAAS_ORIGIN}/api/upload/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      objectKey: token.objectKey,
      fileSize: imageBuffer.byteLength
    })
  });
  const commit = await readJsonResponse(commitRes);
  if (!commit.savedToRecords) {
    throw new Error(commit.error || 'Failed to save record to SaaS');
  }

  return commit.image || commit;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // SaaS Proxy & Info Routes
  app.post("/api/tool/launch", async (req, res) => {
    try {
      const { userId, toolId } = req.body;
      const saasRes = await fetch(`${SAAS_ORIGIN}/api/tool/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, toolId })
      });
      const data = await readJsonResponse(saasRes);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Logic 1: Analyze Reference Image
  app.post("/api/analyze", async (req, res) => {
    const { image } = req.body; 
    if (!image) return res.status(400).json({ error: "Image required" });

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY missing" });

      const imageData = image.includes(',') ? image.split(',')[1] : image;
      const modelName = "gemini-flash-latest";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const payload = {
        contents: [
          {
            parts: [
              { text: "Analyze this beauty e-commerce reference image. 1. Identify the 'Main Product Subject' that should be replaced. 2. List all other 'Environment Elements' (background, props, lighting, model). Format the output as JSON: { \"mainSubject\": \"string\", \"environment\": [\"string\", \"string\"] }" },
              { inlineData: { data: imageData, mimeType: "image/jpeg" } }
            ]
          }
        ]
      };

      const geminiRes = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        return res.status(geminiRes.status).json({ error: "Analysis failed", detail: errText });
      }

      const responseData = await geminiRes.json() as any;
      const resultText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const jsonStart = resultText.indexOf('{');
      const jsonEnd = resultText.lastIndexOf('}') + 1;
      
      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        return res.json({ mainSubject: "product", environment: ["beauty setting"] });
      }

      try {
        const result = JSON.parse(resultText.substring(jsonStart, jsonEnd));
        res.json(result);
      } catch (parseError) {
        res.json({ mainSubject: "product", environment: ["beauty setting"] });
      }
    } catch (error: any) {
      console.error("Analysis Error:", error);
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // Logic 1 & 2: Generate Image
  app.post(["/api/generate", "/api/gemini"], async (req, res) => {
    const { prompt, config, productImage, referenceImage, userId, toolId } = req.body;

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "GEMINI_API_KEY missing" });

      // Step 1: Optional SaaS Verification
      if (userId && toolId) {
        await verifyBeforeGenerate({ userId, toolId });
      }

      // Step 2: AI Generation
      const contentsParts: any[] = [{ text: prompt }];
      
      if (referenceImage) {
        const refData = referenceImage.includes(',') ? referenceImage.split(',')[1] : referenceImage;
        contentsParts.push({ inlineData: { data: refData, mimeType: "image/jpeg" } });
      }
      
      if (productImage) {
        const prodData = productImage.includes(',') ? productImage.split(',')[1] : productImage;
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
        return res.status(geminiRes.status).json({ error: "Generation failed", detail: errText });
      }

      const responseData = await geminiRes.json() as any;
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
        const text = parts.map((p: any) => p.text).filter(Boolean).join("\n");
        return res.status(502).json({ 
          error: "Gemini did not return an image",
          detail: text || "No image data returned"
        });
      }

      const imageBuffer = Buffer.from(imageData, 'base64');
      const base64Url = `data:image/png;base64,${imageData}`;

      // Step 3: SaaS Save flow if IDs provided
      if (userId && toolId) {
        try {
          const saasImage = await saveResultImageToSaas({
            userId,
            toolId,
            imageBuffer,
            mimeType: 'image/png',
            fileName: `beauty-gen-${Date.now()}.png`
          });
          return res.json({ imageUrl: saasImage.url, recordId: saasImage.recordId, saasInfo: saasImage });
        } catch (saasError: any) {
          console.error("SaaS Save Error:", saasError);
          return res.status(502).json({ 
            error: "Image generated but failed to save to SaaS storage", 
            detail: saasError?.message || String(saasError)
          });
        }
      }

      res.json({ imageUrl: base64Url });
    } catch (error: any) {
      console.error("Generation Error:", error);
      res.status(500).json({ error: error.message || "Generation failed" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
