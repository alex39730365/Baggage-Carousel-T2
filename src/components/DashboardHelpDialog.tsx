import { useEffect } from "react";

const Z_HELP_BACKDROP = "z-[210]";
const Z_HELP_PANEL = "z-[211]";

type DashboardHelpDialogProps = {
  open: boolean;
  onClose: () => void;
};

export function DashboardHelpDialog({ open, onClose }: DashboardHelpDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${Z_HELP_BACKDROP} flex items-end justify-center bg-slate-900/45 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 sm:items-center sm:p-4`}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dashboard-help-title"
        className={`${Z_HELP_PANEL} relative max-h-[min(88vh,36rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:rounded-2xl sm:p-5`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="dashboard-help-title" className="text-base font-bold leading-snug text-slate-900 sm:text-lg">
            이용 안내
          </h2>
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="space-y-5 text-sm leading-relaxed text-slate-700">
          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">화면 형식</h3>
            <ul className="list-inside list-disc space-y-1 pl-0.5 text-[13px]">
              <li>
                <strong className="font-semibold text-slate-800">케로셀 현황</strong> — 시간대별·적재대(케로셀)
                격자로 예정 시각과 편명을 봅니다.
              </li>
              <li>
                <strong className="font-semibold text-slate-800">수하물 처리 시간</strong> — 같은 격자에 첫·마지막
                벨트 시각 위주로 표시합니다.
              </li>
              <li>
                <strong className="font-semibold text-slate-800">모바일</strong> — 카드 목록으로 글자를 크게 보기
                좋게 정리한 화면입니다. 좁은 화면에서 격자 대신 쓰기 좋습니다.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">터미널·날짜·검색</h3>
            <ul className="list-inside list-disc space-y-1 pl-0.5 text-[13px]">
              <li>터미널 탭과 날짜는 목록·격자 모두에 동일하게 적용됩니다.</li>
              <li>
                편명 검색은 아래에 맞는 항목만 골라 보여 주며, 행을 누르면 해당 슬롯으로 스크롤하고 잠깐
                강조합니다. 한 번에 최대 20건까지 표시합니다.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">코드셰어·편명 필터</h3>
            <p className="text-[13px]">
              항공사 코드 두 글자 + 숫자 네 자리 형태(예: 타 항공사 마케팅 번호로 보이는 표기)는 목록에서
              숨겨 두어 KE 본편 위주로 보기 쉽게 했습니다. 예외로{" "}
              <strong className="font-semibold text-slate-800">KE</strong> 네 자리 편명 중 천의 자리가{" "}
              <strong className="font-semibold text-slate-800">2</strong>, <strong className="font-semibold text-slate-800">8</strong>
              , 또는 <strong className="font-semibold text-slate-800">9</strong>
              인 경우(예: 2xxx·8xxx·차터 9xxx)는 그대로 표시합니다. CSV 저장 시에도 같은 필터가 적용된 목록이
              내려갑니다.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">강조·색</h3>
            <ul className="list-inside list-disc space-y-1 pl-0.5 text-[13px]">
              <li>
                <strong className="font-semibold text-slate-800">KE 본편</strong>(앞부분이 KE+숫자)은 칸을 파란
                톤으로 자동 강조합니다.
              </li>
              <li>
                칸이나 카드의 <strong className="font-semibold text-slate-800">별(☆)</strong>을 누르면 고정
                강조가 켜지고, KE 본편은 분홍 테두리·다른 편은 보라 테두리로 구분됩니다. 설정은 이
                브라우저에 저장됩니다.
              </li>
              <li>
                데이터가 갱신된 뒤 <strong className="font-semibold text-slate-800">예정 시각·시간대</strong>가
                바뀐 칸은 노란색으로 잠깐 강조됩니다(컨트롤 맨 아래 <strong className="font-semibold text-slate-800">변경 강조 끄기</strong>{" "}
                링크로 끌 수 있음). <strong className="font-semibold text-slate-800">적재대 이동</strong>은 더 오래,
                펄스도 길게 유지됩니다. 작은 배지로 &quot;시간&quot;·&quot;이동&quot;을
                붙입니다.
              </li>
              <li>격자 헤더의 WEST는 초록, EAST는 주황 톤으로 구역만 구분합니다.</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">격자·모바일</h3>
            <ul className="list-inside list-disc space-y-1 pl-0.5 text-[13px]">
              <li>
                격자 헤더에서 <strong className="font-semibold text-slate-800">10·11</strong> 번 열 제목을 누르면
                두 열 사이 빨간 가이드선을 켜거나 끌 수 있습니다.
              </li>
              <li>작은 화면에서 격자는 두 손가락으로 확대·축소(핀치)할 수 있습니다.</li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">모바일 목록·처리 시간</h3>
            <p className="text-[13px]">
              모바일 카드 보기에서 상단 <strong className="font-semibold text-slate-800">처리 시간</strong>을 켜면
              마우스를 올렸을 때 작은 창이 뜹니다. 터치 기기에서는 카드 옆 ⓘ로 같은 내용을 시트로 볼 수
              있습니다.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">데이터·CSV</h3>
            <ul className="list-inside list-disc space-y-1 pl-0.5 text-[13px]">
              <li>공공 API 기준으로 약 1분마다 자동 갱신됩니다. 상단 LIVE 옆 시각이 마지막으로 받아온 시각입니다.</li>
              <li>
                막바지 시간대 등 <strong className="font-semibold text-slate-800">고정 스케줄</strong> 행은 실시간
                API에 처리 시각이 없을 수 있어, 처리 시간 칸이 비어 있을 수 있습니다.
              </li>
              <li>CSV는 현재 화면에 보이는 날짜·터미널·필터와 같은 목록을 파일로 저장합니다.</li>
            </ul>
          </section>

          <p className="border-t border-slate-100 pt-3 text-[12px] text-slate-500">
            본 서비스는 비공식 개인 프로젝트이며, 실제 공항 상황과 다를 수 있습니다. 면책·출처는 페이지
            하단 문구를 참고해 주세요.
          </p>
        </div>
      </div>
    </div>
  );
}
