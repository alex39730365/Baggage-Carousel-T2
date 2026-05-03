import { Analytics } from "@vercel/analytics/react";
import BaggageCarouselBoard from "./components/BaggageCarouselBoard";

export default function App() {
  return (
    <>
      <main className="min-h-screen bg-dashboard-surface px-3 py-4 sm:px-5 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-[1900px]">
          <BaggageCarouselBoard />
        </div>
      </main>
      <Analytics />
    </>
  );
}
