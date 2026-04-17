export type RawBaggageItem = Record<string, unknown>;

export interface BaggageSlot {
  date: string;
  hour: string;
  carousel: number;
  flight: string;
  /** API `typeOfFlight` (예: I 국제, D 국내, O 출발). 고정 스케줄 등은 빈 문자열. */
  typeOfFlight: string;
  estimatedTime: string;
  status: string;
  pieces: string;
  note: string;
  raw: RawBaggageItem;
}
