/**
 * Cloudflare Worker: 인천국제공항공사 수하물 도착 정보 프록시.
 *
 * Vercel Serverless Function은 함수 실행 시간 제한(최대 60s, 플랜별로 더 짧음)이 있어
 * 공공데이터 서버 응답 지연(10~30s)이 겹치면 504 FUNCTION_INVOCATION_TIMEOUT이 발생한다.
 * Cloudflare Worker는 CPU 시간 제한만 있고(대기 시간은 제한되지 않음) Edge 캐싱을
 * 손쉽게 적용할 수 있어 이 프록시로 분리한다.
 *
 * 배포: `npm run worker:deploy` (wrangler.toml 참고)
 * 로컬 실행: `npm run worker:dev`
 */

export interface Env {
  /** Wrangler secret 또는 vars로 주입. 미설정 시 데모 서비스키로 대체. */
  SERVICE_KEY?: string;
  /** 필요 시 업스트림 베이스 URL을 다른 엔드포인트로 교체할 수 있음. */
  UPSTREAM_BASE_URL?: string;
}

/** .env 미설정 시에도 동작하도록 하는 데모 서비스키 — 운영 환경에서는 반드시 SERVICE_KEY로 교체할 것 */
const DEFAULT_SERVICE_KEY =
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

const DEFAULT_UPSTREAM_BASE_URL =
  "https://apis.data.go.kr/B551177/statusOfBaggageClaimDesk/getBaggageArrivals";

/** Edge에서 5분(300s) 캐시 — 공공데이터 서버 부하 완화 */
const CACHE_TTL_SECONDS = 300;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function withCors(headers: HeadersInit = {}): Headers {
  const h = new Headers(headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) h.set(key, value);
  return h;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: withCors() });
    }

    if (request.method !== "GET") {
      return new Response(JSON.stringify({ message: "Method not allowed" }), {
        status: 405,
        headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
      });
    }

    const incomingUrl = new URL(request.url);
    const upstreamBase = (env.UPSTREAM_BASE_URL || DEFAULT_UPSTREAM_BASE_URL).replace(/\/$/, "");
    const serviceKey = env.SERVICE_KEY || DEFAULT_SERVICE_KEY;

    // 클라이언트가 보낸 query 파라미터(type, searchDay 등)를 그대로 원본 API로 전달
    const upstreamUrl = new URL(upstreamBase);
    for (const [key, value] of incomingUrl.searchParams) {
      if (key === "serviceKey") continue; // serviceKey는 서버 측 값을 우선 사용
      upstreamUrl.searchParams.set(key, value);
    }
    if (!upstreamUrl.searchParams.has("type")) upstreamUrl.searchParams.set("type", "json");
    upstreamUrl.searchParams.set("serviceKey", serviceKey);

    try {
      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        // Cloudflare Edge 캐시: 5분간 동일 요청 캐싱하여 업스트림 호출 횟수 감소
        cf: {
          cacheTtl: CACHE_TTL_SECONDS,
          cacheEverything: true,
        },
      });

      const body = await upstreamResponse.text();
      const contentType = upstreamResponse.headers.get("Content-Type") || "application/json; charset=utf-8";

      return new Response(body, {
        status: upstreamResponse.status,
        headers: withCors({
          "Content-Type": contentType,
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return new Response(JSON.stringify({ message: `Upstream request failed: ${message}` }), {
        status: 502,
        headers: withCors({ "Content-Type": "application/json; charset=utf-8" }),
      });
    }
  },
};
