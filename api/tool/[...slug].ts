import { SAAS_ORIGIN, readJsonResponse, corsHeaders } from "../_utils";

export const config = {
  runtime: 'edge',
};

export async function POST(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;

  try {
    const body = await req.json();
    const saasRes = await fetch(`${SAAS_ORIGIN}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await readJsonResponse(saasRes);
    return Response.json(data, { headers: corsHeaders() });
  } catch (error: any) {
    return Response.json({ success: false, message: error.message }, {
      status: 500,
      headers: corsHeaders()
    });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
