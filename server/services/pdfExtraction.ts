export interface PdfExtractionResult {
  text: string;
  pageCount: number;
  isScannedOrImageOnly: boolean;
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const textResult = await parser.getText();
      const cleaned = (textResult.text || '').replace(/\s+/g, ' ').trim();
      const pageCount = Array.isArray(textResult.pages) ? textResult.pages.length : 1;
      const isScannedOrImageOnly = cleaned.length < 40;
      return {
        text: (textResult.text || '').trim(),
        pageCount,
        isScannedOrImageOnly,
      };
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch {
    // In serverless runtimes where pdfjs worker / @napi-rs/canvas native binaries aren't available,
    // fall back cleanly so Gemini's multimodal PDF reader performs direct document extraction.
    return {
      text: '',
      pageCount: 1,
      isScannedOrImageOnly: true,
    };
  }
}
