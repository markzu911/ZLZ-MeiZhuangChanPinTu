export const SAAS_ORIGIN = 'http://aibigtree.com';
console.log('SAAS_ORIGIN_IN_USE:', SAAS_ORIGIN);

export async function saasFetch(url: string, options: RequestInit) {
  console.log('SaaS Request URL:', url);
  try {
    return await fetch(url, options);
  } catch (error: any) {
    console.error("SaaS Fetch Network Error:", error);
    if (error.message?.includes('ERR_TLS_CERT_ALTNAME_INVALID') || error.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      const tlsError = new Error('SaaS HTTPS certificate mismatch');
      (tlsError as any).detail = 'aibigtree.com 的 HTTPS 证书未包含 aibigtree.com，请修复 SaaS 平台证书配置。注意：当前代码已尝试切换到 http://aibigtree.com，如果仍报 TLS 错误，请检查是否有其它地方在请求 https。';
      throw tlsError;
    }
    throw error;
  }
}

export async function readJsonResponse(res: Response) {
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

export async function verifyBeforeGenerate({ userId, toolId }: { userId: string, toolId: string }) {
  if (!userId || !toolId) return null;
  const res = await saasFetch(`${SAAS_ORIGIN}/api/tool/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  });
  return readJsonResponse(res);
}

export async function saveResultImageToSaas({
  userId,
  toolId,
  imageBuffer,
  mimeType = 'image/png',
  fileName = 'result.png'
}: {
  userId: string;
  toolId: string;
  imageBuffer: Uint8Array | ArrayBuffer | Buffer;
  mimeType?: string;
  fileName?: string;
}) {
  // Step 1: Consume points
  const consumeRes = await saasFetch(`${SAAS_ORIGIN}/api/tool/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, toolId })
  });
  await readJsonResponse(consumeRes);

  // Step 2: Get OSS upload token
  const tokenRes = await saasFetch(`${SAAS_ORIGIN}/api/upload/direct-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      mimeType,
      fileName,
      fileSize: imageBuffer instanceof Uint8Array ? imageBuffer.length : (imageBuffer as any).byteLength
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
  const commitRes = await saasFetch(`${SAAS_ORIGIN}/api/upload/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      toolId,
      source: 'result',
      objectKey: token.objectKey,
      fileSize: imageBuffer instanceof Uint8Array ? imageBuffer.length : (imageBuffer as any).byteLength
    })
  });
  const commit = await readJsonResponse(commitRes);
  if (!commit.savedToRecords) {
    throw new Error(commit.error || 'Failed to save record to SaaS');
  }

  return commit.image || commit;
}

export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
