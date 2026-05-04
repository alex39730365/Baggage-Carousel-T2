# 연동 가이드 (배포 · 항공사/사내 인프라)

이 문서는 **웹에 구동**할 때와 **대한항공 등 운영사가 자사 서버·API로 가져갈 때** 필요한 설정을 정리합니다.

## 1. 한 덩어리 배포 (예: Vercel)

- 프론트와 `api/baggage-arrivals`가 같은 도메인이면 **추가 클라이언트 설정 없음**.
- 서버 환경 변수: `DATA_GO_KR_SERVICE_KEY` (공공데이터 사용 시).
- 선택: `KV_REST_API_URL`, `KV_REST_API_TOKEN`.

## 2. 정적 사이트 + API 분리

1. 정적 파일은 CDN/내부 웹서버에 올리고, API만 `https://api.example.com/...` 등에 둡니다.
2. **프론트 빌드 시** `VITE_BAGGAGE_ARRIVALS_URL`에 API 전체 주소를 넣습니다.  
   예: `https://api.example.com/api/baggage-arrivals`
3. API 서버에 **`BAGGAGE_API_CORS_ORIGIN`** 을 정적 사이트 출처와 일치하게 설정합니다.  
   예: `https://dashboard.example.com`

## 3. 업스트림 데이터 소스 (서버 쪽)

### A. 공공데이터 포털 (기본)

- `BAGGAGE_DATA_UPSTREAM_URL` 비움 → 인천 공항 수하물 API 기본 URL 사용.
- 다른 호스트/경로의 호환 게이트웨이를 쓸 때만 `BAGGAGE_DATA_UPSTREAM_URL`에 **쿼리 앞까지의 base URL** 지정.
- 요청 쿼리: `serviceKey`, `type`, `numOfRows`, `pageNo`, `searchDay` (기존 공공데이터와 동일).

게이트웨이가 `serviceKey`를 쓰지 않으면:

- `BAGGAGE_PAGINATED_APPEND_SERVICE_KEY=false`

### B. 사내 단일 스냅샷 API (권장: 항공사 자체 집계 서버)

- **`BAGGAGE_UPSTREAM_SNAPSHOT_URL`** 에 JSON 한 번에 내려주는 URL 지정.
- 인증이 필요하면 **`BAGGAGE_UPSTREAM_AUTHORIZATION`** (예: `Bearer <token>`).
- 허용 응답 형식:
  - 공공데이터와 동일: `response.body.items` 또는 `response.body.items.item` 배열
  - 또는 **항목 객체의 배열** `item[]` (내부 필드 매핑은 기존 `normalizeItem`과 동일 키를 맞추면 됨)

이 모드에서는 공공데이터 **서비스 키 없이** 동작할 수 있습니다 (`DATA_GO_KR_SERVICE_KEY` 미설정 가능).

## 4. 로컬 개발

- `VITE_DATA_GO_KR_SERVICE_KEY` + Vite 프록시(기본은 `apis.data.go.kr`).
- 프록시 대상을 스테이징으로 바꿀 때:  
  `VITE_DEV_BAGGAGE_PROXY_TARGET`, `VITE_DEV_BAGGAGE_PROXY_PATH`

## 5. 환경 변수 요약

| 변수 | 용도 |
|------|------|
| `VITE_BAGGAGE_ARRIVALS_URL` | 브라우저가 호출할 API 절대 URL (분리 배포 시) |
| `DATA_GO_KR_SERVICE_KEY` | 서버 → 공공데이터 (스냅샷 모드가 아닐 때) |
| `BAGGAGE_DATA_UPSTREAM_URL` | 서버 페이지네이션 업스트림 base |
| `BAGGAGE_UPSTREAM_SNAPSHOT_URL` | 서버 단일 스냅샷 URL |
| `BAGGAGE_UPSTREAM_AUTHORIZATION` | 스냅샷 요청 `Authorization` 헤더 |
| `BAGGAGE_PAGINATED_APPEND_SERVICE_KEY` | `false` 시 `serviceKey` 쿼리 생략 |
| `BAGGAGE_API_CORS_ORIGIN` | 교차 출처 허용 시 브라우저 Origin |
| `KV_*` | (선택) 다인스턴스 캐시 공유 |

자세한 예시는 저장소 루트 `.env.example` 을 참고하세요.
