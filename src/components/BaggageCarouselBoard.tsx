import { useBaggageData } from "../hooks/useBaggageData";

const CAROUSELS = Array.from({ length: 19 }, (_, i) => i + 1);

const formatTime = (value: string) => {
  const compact = value.replace(/\D/g, "");
  if (compact.length >= 12) {
    return `${compact.slice(8, 10)}:${compact.slice(10, 12)}`;
  }
  const match = value.match(/(\d{2}:\d{2})/);
  return match ? match[1] : value;
};

const getAirportCode = (raw: Record<string, unknown>): string => {
  const code = raw.airportCode;
  if (typeof code === "string" && code.trim()) return code.trim();
  const airport = raw.airport;
  if (typeof airport === "string" && airport.trim()) return airport.trim();
  return "UNK";
};

const getStand = (raw: Record<string, unknown>): string => {
  const stand = raw.fstandPosition ?? raw.gateNumber;
  if (typeof stand === "string" && stand.trim()) return stand.trim();
  if (typeof stand === "number") return String(stand);
  return "-";
};

export default function BaggageCarouselBoard() {
  const { hours, byHourCarousel, loading, error, lastUpdated } = useBaggageData();

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">Baggage Carousel 현황</h1>
        <p className="mt-1 text-sm text-slate-600">
          API 자동 갱신: 5분 간격 / 캐러셀 1~19 / 시간대별 배치
        </p>
        <p className="mt-1 text-xs text-slate-500">
          마지막 갱신:{" "}
          {lastUpdated ? lastUpdated.toLocaleString("ko-KR", { hour12: false }) : "-"}
        </p>
        {loading && <p className="mt-2 text-sm text-blue-600">데이터를 불러오는 중...</p>}
        {error && <p className="mt-2 text-sm text-red-600">오류: {error}</p>}
      </header>

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[1800px] table-fixed border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50">
            <tr>
              <th className="w-20 border border-slate-200 px-2 py-2 text-center font-semibold text-slate-700">
                시간
              </th>
              {CAROUSELS.map((no) => (
                <th
                  key={no}
                  className="w-52 border border-slate-200 px-2 py-2 text-center font-semibold text-slate-700"
                >
                  {no}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour}>
                <td className="border border-slate-200 bg-slate-50 px-2 py-2 text-center font-medium text-slate-700">
                  {hour}
                </td>
                {CAROUSELS.map((carousel) => {
                  const key = `${hour}-${carousel}`;
                  const items = byHourCarousel.get(key) ?? [];
                  return (
                    <td key={key} className="h-20 border border-slate-200 align-top">
                      <div className="space-y-1 p-2">
                        {items.length === 0 ? (
                          <span className="text-[11px] text-slate-300" />
                        ) : (
                          items.map((item, idx) => (
                            <article key={`${item.flight}-${idx}`} className="whitespace-pre-line rounded bg-slate-50 p-1.5 leading-4 text-slate-800">
                              <p className="font-semibold text-slate-900">
                                {`${item.flight || "미지정"} / ${getAirportCode(item.raw)}`}
                              </p>
                              <p>{`${formatTime(item.estimatedTime)} / ${getStand(item.raw)}`}</p>
                              {!!item.pieces && <p>{item.pieces.toLowerCase().includes("pc") ? item.pieces : `${item.pieces} pc`}</p>}
                            </article>
                          ))
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
