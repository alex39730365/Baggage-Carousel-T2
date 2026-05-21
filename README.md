# Baggage Carousel React Component

엑셀 `Baggage Carousel 현황표` 레이아웃(시간 × 캐러셀 **1~20번** 격자)을 React + Tailwind CSS로 옮긴 컴포넌트입니다.

## 구성 파일

- `src/App.tsx`
- `src/components/BaggageCarouselBoard.tsx`
- `src/dashboard/DashboardControlStack.tsx` — 상단 필터·CSV 카드 묶음
- `src/components/CsvExportBar.tsx` — CSV 저장·토스트·감사 로그·Analytics 이벤트
- `src/lib/csvExport.ts` — CSV 문자열 생성
- `src/hooks/useBaggageData.ts`
- `src/lib/baggageApi.ts`
- `src/types.ts`
- `api/baggage-arrivals.ts` (배포용 서버리스 API)
- `vercel.json`
- `docs/CSV_EXPORT.md` — CSV 스펙
- `docs/DATA_HANDLING.md` — 데이터·공유 시 유의사항

## 테스트

```bash
npm run test
```

`src/lib/csvExport.test.ts` — BOM, 헤더, 시각 가공, 따옴표 이스케이프.

## 동작 방식

- API 호출 URL: 공항 수하물 캐러셀 API
- 초기 렌더 시 1회 호출
- 이후 약 `1분` 간격 자동 재호출(클라이언트 `REFRESH_MS`·서버 `UPSTREAM_CACHE_TTL_MS`와 동일)
- 응답 `item[]` 데이터를 시간(`HH:00`) + 캐러셀 번호(**1~20**)로 매핑해 표 렌더
- 마지막으로 받은 운항 목록은 `localStorage`에 날짜별로 저장해 **새로고침 후에도** 이전 표를 복원(캐시 TTL 7일). 고정 스케줄은 `fixedSchedule.json`에서 매번 병합

## 프로젝트에 붙이는 방법

1. Tailwind가 적용된 React 프로젝트에 위 `src` 파일들을 복사
2. `App.tsx`를 현재 앱 구조에 맞게 병합
3. 필요 시 `baggageApi.ts`의 필드 매핑 키를 운영 데이터에 맞춰 추가

## Vercel 배포 방법

1. 저장소를 GitHub에 push
2. [Vercel](https://vercel.com/)에서 `New Project` -> 저장소 Import
3. Framework Preset은 `Vite` 그대로 사용
4. (권장) Environment Variable 추가
   - `DATA_GO_KR_SERVICE_KEY` = 발급받은 일반 인증키
5. Deploy 클릭

배포 후 브라우저에서 `<배포주소>/api/baggage-arrivals`가 JSON을 반환하면 정상입니다.

## 참고

- **다른 호스팅·사내 API·CORS·스냅샷 URL** 은 [INTEGRATION.md](./INTEGRATION.md) 참고.
- [CSV 보내기 스펙](./docs/CSV_EXPORT.md), [데이터 취급·보안 메모](./docs/DATA_HANDLING.md)
- 필드명이 환경마다 다를 수 있어 `flightId`, `estimatedDatetime`, `lateralNo`, `lateral1Status` 등 복수 키를 순차 탐색하도록 작성됨
- 로컬 개발 시 Vite 프록시를 사용하고, 배포 시에는 `api/baggage-arrivals.ts` 서버리스 함수가 공공 API를 중계합니다

취업·포트폴리오용으로 정리한 설명 문서는 `docs/취업용-포트폴리오-문서.md`를 참고하세요.

운영·구축·API 요약은 **`통합문서.md`** 를 참고하세요.
