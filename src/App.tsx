import { Analytics } from "@vercel/analytics/react";
import BaggageCarouselBoard from "./components/BaggageCarouselBoard";

export default function App() {
  return (
    <>
      <main id="baggage-main" className="min-h-screen bg-dashboard-surface px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
        <a
          href="#baggage-main"
          className="sr-only rounded bg-[#1e40af] px-3 py-2 text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[300] focus:shadow-lg"
        >
          본문으로 건너뛰기
        </a>
        <div className="mx-auto w-full max-w-[1900px]">
          <BaggageCarouselBoard />
        </div>
      </main>
      <Analytics />
    </>
  );
}
