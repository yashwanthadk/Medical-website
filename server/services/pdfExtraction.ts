import { PDFParse } from 'pdf-parse';

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  isScannedOrImageOnly: boolean;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    const textResult = await parser.getText();
    const cleaned = (textResult.text || '').replace(/\s+/g, ' ').trim();
    const pageCount = Array.isArray(textResult.pages) ? textResult.pages.length : 1;
    // If very little selectable text was extracted, treat as scanned PDF needing multimodal vision OCR
    const isScannedOrImageOnly = cleaned.length < 40;
    return {
      text: (textResult.text || '').trim(),
      pageCount,
      isScannedOrImageOnly,
    };
  } catch (err) {
    throw new Error(
      `Unable to parse PDF document: ${err instanceof Error ? err.message : 'Invalid PDF structure'}`
    );
  } finally {
    await parser.destroy().catch(() => {});
  }
}
