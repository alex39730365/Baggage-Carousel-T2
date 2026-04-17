import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        host: true,
        proxy: {
            "/api/baggage-arrivals": {
                target: "https://apis.data.go.kr",
                changeOrigin: true,
                secure: true,
                rewrite: function (path) {
                    var rewritten = path.replace(/^\/api\/baggage-arrivals/, "/B551177/statusOfBaggageClaimDesk/getFltArrivalsBaggageClaimDesk");
                    if (rewritten.indexOf("serviceKey=") >= 0)
                        return rewritten;
                    var connector = rewritten.indexOf("?") >= 0 ? "&" : "?";
                    return "".concat(rewritten).concat(connector, "serviceKey=21c3a7130b45aa44a1f4c71804810b183e48a420fbb8a26721466ad626a0c6ea");
                },
            },
        },
    },
});
