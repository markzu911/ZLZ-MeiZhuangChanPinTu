import { getGemini, corsHeaders } from "./_utils";

export const config = {
  runtime: 'edge',
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'GEMINI_API_KEY is not configured in Vercel' }, { status: 500 });
    }

    const body = await req.json();
    const image = body.image;
    if (!image) {
      return Response.json({ error: 'Image required' }, { status: 400 });
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

    return Response.json(result, { headers: corsHeaders() });
  } catch (error: any) {
    console.error("Analyze API Error:", error);
    return Response.json({ error: error.message || "Analysis failed" }, { 
      status: 500,
      headers: corsHeaders()
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
