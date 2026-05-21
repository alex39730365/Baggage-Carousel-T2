# CSV 보내기 스펙

## 목적

현재 화면에 가깝게 걸러진 슬롯 목록을 **클릭 시점 스냅샷**으로 파일에 저장한다. 실시간 스트림이 아니며, 저장 후 파일 내용은 자동으로 갱신되지 않는다.

## 데이터 범위(행이 되는 조건)

UI의 **`visibleSlots`** 와 동일한 배열을 넘긴다. 즉 다음이 반영된다.

- 선택 **날짜** (`selectedDate`)
- **터미널** 탭(전체 / 터미널1 / 터미널2)
- **KE 코드셰어 숨김** 옵션이 켜져 있으면 해당 필터 적용
- 출발편 등은 기존 `excludeOutboundFlights` 등 보드 쪽 로직과 동일

**편명 검색창**은 격자 데이터를 줄이지 않으므로 CSV 행 수에도 반영되지 않는다(이동·하이라이트용).

## 파일 형식

| 항목 | 값 |
|------|-----|
| 인코딩 | UTF-8, 파일 선두 BOM(`U+FEFF`) |
| 줄바꿈 | CRLF `\r\n` 행 구분, 파일 끝에 마지막 줄바꿈 1개 |
| 구분자 | 쉼표 `,` |
| 따옴표 | RFC 4180 스타일 — 필드에 `,` `"` 줄바꿈 포함 시 `"` 로 감싸고 내부 `"` 는 `""` 로 이스케이프 |

## 열 정의(헤더 순서)

1. 날짜 — `BaggageSlot.date`
2. 시간대 — `hour`
3. 케로셀 — 숫자
4. 편명
5. 국내외 — `typeOfFlight`
6. 예정시각 — Excel 과학적 표기 방지용 가공(아래 시각 규칙)
7. 상태
8. 수하물
9. 비고
10. 스탠드 — raw `fstandPosition` / `gateNumber` 등
11. 착륙시각 — raw `landingDatetime` / `landingDateTime` 등, 시각 규칙 동일
12. 첫수하물 — raw `bagFirstTime` 등
13. 마지막수하물 — raw `bagLastTime` 등

## 시각 필드 가공(`spreadsheetSafeDateTime`)

- 연속 숫자 **12자리 이상**(`YYYYMMDDHHmm` 또는 14자리 초까지): 날짜 부분은 버리고 **`HH:mm`** 또는 **`HH:mm:ss`** 만 남긴다(행의 `날짜` 열과 중복 방지).
- 연속 숫자 **8자리**(`YYYYMMDD`): `YYYY-MM-DD` 로 구분符 삽입.
- 그 외는 원문 trim 유지.

## 파일명

`수하물현황_{날짜}_{터미널슬러그}_{서울시각HHmmss}.csv`

- 서울 타임존 기준 시·분·초 6자리.

## 구현 위치

- `src/lib/csvExport.ts` — 문자열 생성·다운로드
- `src/components/CsvExportBar.tsx` — 버튼, 토스트, Vercel `track("csv_export")`, `sessionStorage` 감사 로그
- `src/lib/clientAuditLog.ts` — 브라우저 감사 링 버퍼

## 테스트

`npm run test` — `src/lib/csvExport.test.ts` 에서 BOM·헤더·시각 가공·쉼표 이스케이프를 검증한다.
