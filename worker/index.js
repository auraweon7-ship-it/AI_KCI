/**
 * KCI Open API CORS Proxy - Cloudflare Worker
 * GitHub Pages 등 정적 호스팅에서 KCI API를 호출할 수 있도록 CORS 헤더를 추가합니다.
 */

const ALLOWED_ORIGINS = [
  'https://auraweon7-ship-it.github.io',
  'https://aikci-production.up.railway.app',
  'http://localhost:8080',
  'http://localhost:3000',
  'http://127.0.0.1:8080'
];

const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function getCorsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const headers = { ...CORS_HEADERS };
  if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.github.io')) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGINS[0];
  }
  return headers;
}

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: getCorsHeaders(request) });
    }

    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'kci-proxy' }), {
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
      });
    }

    // KCI API proxy
    if (url.pathname === '/api/kci') {
      const params = url.searchParams;
      const kciUrl = `${env.KCI_BASE_URL}?${params.toString()}`;

      try {
        const kciRes = await fetch(kciUrl, {
          headers: { 'User-Agent': 'KCI-Proxy/1.0' }
        });
        const body = await kciRes.text();

        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
            ...getCorsHeaders(request)
          }
        });
      } catch (e) {
        return new Response(`Proxy error: ${e.message}`, {
          status: 502,
          headers: { 'Content-Type': 'text/plain', ...getCorsHeaders(request) }
        });
      }
    }

    return new Response('Not found. Use /api/kci?apiCode=...', {
      status: 404,
      headers: { 'Content-Type': 'text/plain', ...getCorsHeaders(request) }
    });
  }
};
