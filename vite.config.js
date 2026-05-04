import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
/** 공공데이터 샘플용(인코딩 전). 로컬 `npm run dev`에서 .env 미설정 시에만 사용 — 운영은 반드시 VITE_DATA_GO_KR_SERVICE_KEY 설정 */
var DEV_FALLBACK_SERVICE_KEY = "21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea";
export default defineConfig(function (_a) {
    var _b, _c, _d;
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), "");
    var fromEnv = ((_b = env.VITE_DATA_GO_KR_SERVICE_KEY) !== null && _b !== void 0 ? _b : "").trim();
    var serviceKey = fromEnv || (mode === "development" ? DEV_FALLBACK_SERVICE_KEY : "");
    var devProxyTarget = ((_c = env.VITE_DEV_BAGGAGE_PROXY_TARGET) !== null && _c !== void 0 ? _c : "https://apis.data.go.kr").trim();
    var devProxyPath = ((_d = env.VITE_DEV_BAGGAGE_PROXY_PATH) !== null && _d !== void 0 ? _d : "/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk").trim() ||
        "/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk";
    return {
        plugins: [react()],
        server: {
            port: 5173,
            host: true,
            proxy: {
                "/api/baggage-arrivals": {
                    target: devProxyTarget,
                    changeOrigin: true,
                    secure: true,
                    rewrite: function (path) {
                        var rewritten = path.replace(/^\/api\/baggage-arrivals/, devProxyPath);
                        if (rewritten.indexOf("serviceKey=") >= 0)
                            return rewritten;
                        var connector = rewritten.indexOf("?") >= 0 ? "&" : "?";
                        if (!serviceKey) {
                            console.warn("[vite] VITE_DATA_GO_KR_SERVICE_KEY가 없고 production 빌드라 프록시에 키를 붙일 수 없습니다. .env를 확인하세요.");
                            return rewritten;
                        }
                        return "".concat(rewritten).concat(connector, "serviceKey=").concat(encodeURIComponent(serviceKey));
                    },
                },
            },
        },
    };
});
