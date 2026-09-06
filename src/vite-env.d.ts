/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 예: `https://api.company.com/baggage/v1/arrivals` — 비우면 동일 출처 `/api/baggage-arrivals` */
  readonly VITE_BAGGAGE_ARRIVALS_URL?: string;
  readonly VITE_DATA_GO_KR_SERVICE_KEY?: string;
  /** Cloudflare Worker 프록시 주소. 예: `https://baggage-proxy.<subdomain>.workers.dev`. 설정 시 최우선으로 사용됨. */
  readonly VITE_WORKER_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
