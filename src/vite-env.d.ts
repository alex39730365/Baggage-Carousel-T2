/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 예: `https://api.company.com/baggage/v1/arrivals` — 비우면 동일 출처 `/api/baggage-arrivals` */
  readonly VITE_BAGGAGE_ARRIVALS_URL?: string;
  readonly VITE_DATA_GO_KR_SERVICE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
