import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SAAS_ORIGIN, saasFetch, corsHeaders } from "../_utils.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders();
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Vercel node function req.url is the full path with query
  const fullPath = req.url || '';
  // For [...slug].ts, the slug is at the end. But usually we want prefixing.
  // In Vercel /api/tool/[...slug], if we call /api/tool/verify, path is /api/tool/verify
  
  try {
    const saasRes = await saasFetch(`${SAAS_ORIGIN}${fullPath}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {})
    });
    
    const text = await saasRes.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : { raw: text };
    } catch {
      data = { error: "Failed to parse SaaS response", raw: text.slice(0, 500) };
    }

    if (!saasRes.ok || data.success === false) {
      return res.status(saasRes.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
