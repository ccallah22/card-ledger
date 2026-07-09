export type OCRTextLine = {
  text: string;
  confidence: number;
};

export type OCRResult = {
  lines: OCRTextLine[];
  rawText: string;
  confidence: number;
  engine: string;
};

export interface OcrEngine {
  recognize(imageDataUrl: string): Promise<OCRResult>;
}
