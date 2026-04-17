export type RawBaggageItem = Record<string, unknown>;

export interface BaggageSlot {
  hour: string;
  carousel: number;
  flight: string;
  estimatedTime: string;
  status: string;
  pieces: string;
  note: string;
  raw: RawBaggageItem;
}
