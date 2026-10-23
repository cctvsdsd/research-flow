// Cloudflare Pages Function: /api/data
// GET  → 从 KV 读取数据
// PUT  → 写入数据到 KV
// KV namespace binding: DATA
// 注意：Pages Functions 只能跑纯 JavaScript，不要写 TypeScript 类型注解

const KEY = 'research-flow-state';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const env = context.env;
    if (!env || !env.DATA) return json({ error: 'KV not bound' }, 500);
    const raw = await env.DATA.get(KEY);
    if (!raw) return json({ tasks: [], rev: 0 });
    const data = JSON.parse(raw);
    return json(data);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

export async function onRequestPut(context) {
  try {
    const env = context.env;
    const request = context.request;
    if (!env || !env.DATA) return json({ error: 'KV not bound' }, 500);
    const body = await request.json();
    const incomingRev = Number(body && body.rev) || 0;

    // 比较版本号：只有 incoming rev > 远端 rev 才写入（防止旧数据覆盖新数据）
    const existing = await env.DATA.get(KEY);
    let existingRev = 0;
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        existingRev = Number(parsed && parsed.rev) || 0;
      } catch (e) {
        // ignore parse error
      }
    }

    if (incomingRev > existingRev) {
      await env.DATA.put(KEY, JSON.stringify(body));
      return json({ ok: true, rev: incomingRev, action: 'written' });
    }
    // 远端比本地新或一致 → 拒绝写入，返回远端数据
    const remoteData = existing ? JSON.parse(existing) : { tasks: [], rev: 0 };
    return json({ ok: false, rev: existingRev, action: 'rejected', remoteData });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
