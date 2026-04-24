import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/** 공공데이터 샘플용(인코딩 전). 로컬 `npm run dev`에서 .env 미설정 시에만 사용 — 운영은 반드시 VITE_DATA_GO_KR_SERVICE_KEY 설정 */
const DEV_FALLBACK_SERVICE_KEY =
  "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const fromEnv = (env.VITE_DATA_GO_KR_SERVICE_KEY ?? "").trim();
  const serviceKey = fromEnv || (mode === "development" ? DEV_FALLBACK_SERVICE_KEY : "");

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      proxy: {
        "/api/baggage-arrivals": {
          target: "https://apis.data.go.kr",
          changeOrigin: true,
          secure: true,
          rewrite: (path) => {
            const rewritten = path.replace(
              /^\/api\/baggage-arrivals/,
              "/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk"
            );
            if (rewritten.indexOf("serviceKey=") >= 0) return rewritten;
            const connector = rewritten.indexOf("?") >= 0 ? "&" : "?";
            if (!serviceKey) {
              console.warn(
                "[vite] VITE_DATA_GO_KR_SERVICE_KEY가 없고 production 빌드라 프록시에 키를 붙일 수 없습니다. .env를 확인하세요."
              );
              return rewritten;
            }
            return `${rewritten}${connector}serviceKey=${encodeURIComponent(serviceKey)}`;
          },
        },
      },
    },
  };
});
