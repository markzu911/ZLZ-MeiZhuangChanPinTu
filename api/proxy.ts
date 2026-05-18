import { GoogleGenAI } from "@google/genai";

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
      'Content-Type': mimeType
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

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;

  // Handle CORS OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  // Health check
  if (path === '/api/health') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Forward SaaS tool routes
  if (path.startsWith('/api/tool/')) {
    try {
      const body = await req.json();
      const saasRes = await fetch(`${SAAS_ORIGIN}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await readJsonResponse(saasRes);
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ success: false, message: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  // Handle Gemini related tasks
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' }
    }
  });

  // Handle Analyze
  if (path === '/api/analyze') {
    try {
      const { image } = await req.json();
      if (!image) return new Response('Image required', { status: 400 });

      const imageData = image.includes(',') ? image.split(',')[1] : image;
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
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
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }

  // Handle Generate / Gemini
  if (path === '/api/generate' || path === '/api/gemini') {
    try {
      const { prompt, config, productImage, referenceImage, userId, toolId } = await req.json();

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
          imageConfig: config,
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
        return new Response(JSON.stringify({ text: response.text }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const imageBuffer = Buffer.from(imageData, 'base64');
      const base64Url = `data:image/png;base64,${imageData}`;

      if (userId && toolId) {
        try {
          const saasImage = await saveResultImageToSaas({
            userId,
            toolId,
            imageBuffer,
            mimeType: 'image/png',
            fileName: `beauty-gen-${Date.now()}.png`
          });
          return new Response(JSON.stringify({ imageUrl: saasImage.url, recordId: saasImage.recordId, saasInfo: saasImage }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (saasError: any) {
          return new Response(JSON.stringify({ imageUrl: base64Url, saasError: saasError.message }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      return new Response(JSON.stringify({ imageUrl: base64Url }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response('Not Found', { status: 404 });
}
