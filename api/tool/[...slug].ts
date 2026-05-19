import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SAAS_ORIGIN, readJsonResponse, corsHeaders } from "../_utils.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = corsHeaders();

  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const path = req.url?.split('?')[0] || '';

  try {
    const body = req.body || {};
    const saasRes = await fetch(`${SAAS_ORIGIN}${path}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
      body: req.method === 'GET' ? undefined : JSON.stringify(body)
    });
    
    // We need to use readJsonResponse logic but it might throw
    const text = await saasRes.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 300) };
    }

    if (!saasRes.ok || data.success === false) {
      return res.status(saasRes.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
