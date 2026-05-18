// ════════════════════════════════════════════════════════════
//  StockAI Pro — Cloudflare Worker 프록시
//  Anthropic API 비용 우리 부담 + 라이선스 검증 + 사용량 관리
//
//  배포 방법:
//   1. Cloudflare → Workers & Pages → Create Worker
//   2. 이름: stockai-proxy
//   3. 이 파일 내용 전체 복붙
//   4. Settings → Variables 추가:
//      - ANTHROPIC_API_KEY (Anthropic 콘솔에서 발급)
//      - ADMIN_SECRET (관리자 엔드포인트 보호용 랜덤 문자열)
//   5. KV Namespace 추가:
//      - LICENSE_KV (라이선스 + 사용량 저장)
//   6. Custom Domain: api.stockai.maeulhang.kr 또는 stockai-proxy.{your}.workers.dev
//   7. 주식AI비서.html에서 WORKER_URL을 위 URL로 변경
// ════════════════════════════════════════════════════════════

const SALT = 'stockai2026#!';

// ─ 플랜 한도 (월간) ─
const PLAN_LIMITS = {
  free:  { ai: 20,    msg: 'FREE: 월 20회 AI 분석' },
  basic: { ai: 300,   msg: 'BASIC: 월 300회' },
  pro:   { ai: 2000,  msg: 'PRO: 월 2000회' },
  vip:   { ai: 10000, msg: 'VIP: 월 10000회' },
};

const PLAN_CODES = { free: 'FREE', basic: 'BAS', pro: 'PRO', vip: 'VIP' };

// ─ 허용 도메인 (CORS) ─
const ALLOWED_ORIGINS = [
  'https://stockai.maeulhang.kr',
  'https://maeulhang.kr',
  'https://solanavi.kr',
  'https://w1nter1052.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null',  // file:// 로컬 테스트
];

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o + '/')) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-license-key, x-admin-secret, anthropic-version',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Expose-Headers': 'x-sai-plan, x-sai-usage, x-sai-limit, x-sai-expires',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

// ─ 라이선스 해시 (간단 검증) ─
async function hashLicense(key) {
  const data = new TextEncoder().encode(key + SALT);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 키 포맷: SAI-XXXX-XXXX-YYMM (16자 + dash)
function isValidKeyFormat(key) {
  return /^SAI-[A-Z0-9]{4}-[A-Z0-9]{4}-\d{4}$/i.test(key);
}

// 사용량 체크
async function getMonthUsage(env, licenseKey) {
  const month = new Date().toISOString().slice(0,7);  // YYYY-MM
  const k = `usage:${licenseKey}:${month}`;
  return parseInt((await env.LICENSE_KV.get(k)) || '0', 10);
}

async function incrementUsage(env, licenseKey) {
  const month = new Date().toISOString().slice(0,7);
  const k = `usage:${licenseKey}:${month}`;
  const cur = await getMonthUsage(env, licenseKey);
  await env.LICENSE_KV.put(k, String(cur + 1), { expirationTtl: 60*60*24*45 });  // 45일 보관
  return cur + 1;
}

// 라이선스 조회 (KV 또는 free)
async function getLicensePlan(env, licenseKey) {
  if(!licenseKey) return 'free';  // 키 없으면 free 무료 체험
  if(!isValidKeyFormat(licenseKey)) return 'free';
  // 해시 기반 조회 (보안)
  const hash = await hashLicense(licenseKey);
  const stored = await env.LICENSE_KV.get(`license:${hash}`);
  if(!stored){
    // legacy: 평문 키 그대로 저장된 경우 호환
    const legacy = await env.LICENSE_KV.get(`license:${licenseKey}`);
    if(!legacy) return null;
    try { return JSON.parse(legacy).plan || 'free'; } catch(e) { return null; }
  }
  try {
    const info = JSON.parse(stored);
    if(info.revoked) return null;  // 취소된 키
    if(info.expiresAt && info.expiresAt < Date.now()) return null;  // 만료
    return info.plan || 'free';
  } catch(e) { return null; }
}

// ════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    // CORS Preflight
    if(request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // ─ Routes ─
    if(url.pathname === '/v1/messages' || url.pathname === '/anthropic/messages') {
      return handleAnthropicProxy(request, env, cors);
    }
    if(url.pathname === '/license/check') {
      return handleLicenseCheck(request, env, cors);
    }
    if(url.pathname === '/license/usage') {
      return handleUsageCheck(request, env, cors);
    }
    if(url.pathname.startsWith('/admin/')) {
      return handleAdmin(request, env, cors, url);
    }
    if(url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'stockai-proxy', time: new Date().toISOString() }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
};

// ─ Anthropic 프록시 (핵심) ─
async function handleAnthropicProxy(request, env, cors) {
  try {
    const licenseKey = request.headers.get('x-license-key') || '';
    const plan = await getLicensePlan(env, licenseKey);
    if(plan === null){
      return new Response(JSON.stringify({ error: '유효하지 않은 라이선스 키' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 사용량 체크
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const usage = licenseKey ? await getMonthUsage(env, licenseKey) : await getMonthUsage(env, 'anon:' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
    if(usage >= limits.ai){
      return new Response(JSON.stringify({
        error: `${PLAN_CODES[plan]} 플랜 월 ${limits.ai}회 한도 초과. PRO 업그레이드 시 더 많이 사용 가능합니다.`,
        plan, usage, limit: limits.ai
      }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json', 'x-sai-plan': plan, 'x-sai-usage': String(usage), 'x-sai-limit': String(limits.ai) } });
    }

    // Anthropic API 호출
    const body = await request.json();
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    if(resp.ok){
      // 성공 시 사용량 증가
      const newUsage = licenseKey
        ? await incrementUsage(env, licenseKey)
        : await incrementUsage(env, 'anon:' + (request.headers.get('CF-Connecting-IP') || 'unknown'));

      const respBody = await resp.text();
      return new Response(respBody, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'x-sai-plan': plan,
          'x-sai-usage': String(newUsage),
          'x-sai-limit': String(limits.ai)
        }
      });
    }

    // 오류 패스스루
    const errBody = await resp.text();
    return new Response(errBody, { status: resp.status, headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
}

// ─ 라이선스 검증 ─
async function handleLicenseCheck(request, env, cors) {
  const licenseKey = request.headers.get('x-license-key') || '';
  const plan = await getLicensePlan(env, licenseKey);
  if(plan === null) return new Response(JSON.stringify({ valid: false }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const usage = licenseKey ? await getMonthUsage(env, licenseKey) : 0;
  return new Response(JSON.stringify({ valid: true, plan, usage, limit: limits.ai, remaining: Math.max(0, limits.ai - usage) }), { headers: { ...cors, 'Content-Type': 'application/json' } });
}

async function handleUsageCheck(request, env, cors) {
  return handleLicenseCheck(request, env, cors);
}

// ─ 관리자 (라이선스 발급/조회/연장/취소) ─
async function handleAdmin(request, env, cors, url) {
  const secret = request.headers.get('x-admin-secret') || '';
  if(secret !== env.ADMIN_SECRET){
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  const path = url.pathname.replace('/admin/', '');
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' };

  // 라이선스 발급: POST /admin/issue
  // body: { plan, email, name, days?, key?, orderId?, paidAmount?, paidMethod?, expiresAt?, note? }
  if(path === 'issue'){
    const body = await request.json();
    const plan = body.plan || 'basic';
    if(!PLAN_LIMITS[plan]) return new Response(JSON.stringify({error:'bad_plan', message:'유효한 플랜: free, basic, pro, vip'}), { status: 400, headers: jsonHeaders });
    const key = body.key || generateLicenseKey();
    const hash = await hashLicense(key);
    const days = body.days || 30;
    const expiresAt = body.expiresAt || (Date.now() + days * 86400000);
    const info = {
      hash, plan,
      email: body.email || '',
      name: body.name || '',
      orderId: body.orderId || '',
      issuedAt: Date.now(),
      expiresAt,
      paidAmount: body.paidAmount || 0,
      paidMethod: body.paidMethod || 'bank_transfer',
      note: body.note || '',
      revoked: false
    };
    // 해시 기반 저장
    await env.LICENSE_KV.put(`license:${hash}`, JSON.stringify(info));
    // 이메일 인덱스 (lookup용)
    if(body.email){
      const existing = await env.LICENSE_KV.get(`email:${body.email}`);
      const keys = existing ? JSON.parse(existing) : [];
      keys.unshift({ hash, plan, issuedAt: info.issuedAt, expiresAt });
      if(keys.length > 50) keys.length = 50;
      await env.LICENSE_KV.put(`email:${body.email}`, JSON.stringify(keys));
    }
    return new Response(JSON.stringify({
      ok: true,
      key,  // 평문 키 (한 번만 표시)
      license: { ...info, key },
      message: '발급 완료. 평문 키는 다시 표시되지 않습니다.'
    }), { headers: jsonHeaders });
  }

  // 라이선스 검색: GET /admin/lookup?email=... or ?key=...
  if(path === 'lookup'){
    const email = url.searchParams.get('email');
    const key = url.searchParams.get('key');
    if(email){
      const raw = await env.LICENSE_KV.get(`email:${email}`);
      return new Response(JSON.stringify({ ok: true, email, keys: raw ? JSON.parse(raw) : [] }), { headers: jsonHeaders });
    }
    if(key){
      const hash = await hashLicense(key);
      const stored = await env.LICENSE_KV.get(`license:${hash}`);
      if(!stored) return new Response(JSON.stringify({ ok: false, error:'not_found' }), { status: 404, headers: jsonHeaders });
      return new Response(JSON.stringify({ ok: true, license: JSON.parse(stored) }), { headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ error: 'bad_request', message: 'email 또는 key 파라미터 필요' }), { status: 400, headers: jsonHeaders });
  }

  // 전체 목록: GET /admin/list
  if(path === 'list'){
    const list = await env.LICENSE_KV.list({ prefix: 'license:', limit: 1000 });
    return new Response(JSON.stringify({
      ok: true,
      count: list.keys.length,
      keys: list.keys.map(k => k.name.replace('license:', '').slice(0, 12) + '...')  // 해시 prefix만
    }), { headers: jsonHeaders });
  }

  // 만료 연장: POST /admin/extend  body: { key, days }
  if(path === 'extend'){
    const body = await request.json();
    if(!body.key) return new Response(JSON.stringify({ error: 'bad_request', message:'key 필요' }), { status: 400, headers: jsonHeaders });
    const hash = await hashLicense(body.key);
    const stored = await env.LICENSE_KV.get(`license:${hash}`);
    if(!stored) return new Response(JSON.stringify({ ok: false, error:'not_found' }), { status: 404, headers: jsonHeaders });
    const data = JSON.parse(stored);
    const days = body.days || 30;
    const base = data.expiresAt && data.expiresAt > Date.now() ? data.expiresAt : Date.now();
    data.expiresAt = base + days * 86400000;
    data.revoked = false;
    await env.LICENSE_KV.put(`license:${hash}`, JSON.stringify(data));
    return new Response(JSON.stringify({ ok: true, expires: new Date(data.expiresAt).toISOString(), message: `${days}일 연장 완료` }), { headers: jsonHeaders });
  }

  // 즉시 취소: POST /admin/revoke  body: { key }
  if(path === 'revoke'){
    const body = await request.json();
    if(!body.key) return new Response(JSON.stringify({ error: 'bad_request', message:'key 필요' }), { status: 400, headers: jsonHeaders });
    const hash = await hashLicense(body.key);
    const stored = await env.LICENSE_KV.get(`license:${hash}`);
    if(!stored) return new Response(JSON.stringify({ ok: false, error:'not_found' }), { status: 404, headers: jsonHeaders });
    const data = JSON.parse(stored);
    data.revoked = true;
    data.revokedAt = Date.now();
    await env.LICENSE_KV.put(`license:${hash}`, JSON.stringify(data));
    return new Response(JSON.stringify({ ok: true, revoked: body.key, message: '즉시 차단됨' }), { headers: jsonHeaders });
  }

  // 통계: GET /admin/stats
  if(path === 'stats'){
    const list = await env.LICENSE_KV.list({ prefix: 'license:', limit: 1000 });
    let plans = { free: 0, basic: 0, pro: 0, vip: 0 };
    let active = 0, expired = 0, revoked = 0;
    const now = Date.now();
    for(const k of list.keys){
      const raw = await env.LICENSE_KV.get(k.name);
      if(!raw) continue;
      try {
        const d = JSON.parse(raw);
        if(d.plan && plans[d.plan] !== undefined) plans[d.plan]++;
        if(d.revoked) revoked++;
        else if(d.expiresAt && d.expiresAt < now) expired++;
        else active++;
      } catch(e){}
    }
    return new Response(JSON.stringify({ ok: true, total: list.keys.length, plans, active, expired, revoked }), { headers: jsonHeaders });
  }

  return new Response(JSON.stringify({ error: 'unknown admin endpoint', endpoints: ['issue','lookup','list','extend','revoke','stats'] }), { status: 404, headers: jsonHeaders });
}

// ─ 라이선스 키 생성 ─
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';  // 헷갈리는 문자 제외 (O,0,I,1)
  const seg = () => Array.from({length:4}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const yymm = new Date().toISOString().slice(2,7).replace('-','');
  return `SAI-${seg()}-${seg()}-${yymm}`;
}
