import * as pdfjsLib from 'pdfjs-dist';

// Use unpkg CDN which has all versions
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface ParsedDocument {
  text: string;
  chunks: { text: string; page: number }[];
}

export const parseFile = async (file: File): Promise<ParsedDocument> => {
  const fileType = file.type;
  const fileName = file.name.toLowerCase();

  console.log(`[Parser] File: ${file.name}, Type: ${fileType}`);

  try {
    if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
      return await parsePDF(file);
    } else {
      return await parseText(file);
    }
  } catch (error) {
    console.error('[Parser] Error:', error);
    throw error;
  }
};

const parsePDF = async (file: File): Promise<ParsedDocument> => {
  console.log('[PDF] Starting...');

  const arrayBuffer = await file.arrayBuffer();
  console.log(`[PDF] Buffer: ${arrayBuffer.byteLength} bytes`);

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  console.log(`[PDF] Loaded: ${pdf.numPages} pages`);

  const chunks: { text: string; page: number }[] = [];
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    const text = content.items
      .map((item: any) => item.str || '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 0) {
      chunks.push({ text, page: i });
      fullText += text + '\n\n';
      console.log(`[PDF] Page ${i}: ${text.length} chars`);
    }
  }

  if (fullText.trim().length === 0) {
    throw new Error('No text in PDF - may be scanned/image-based');
  }

  console.log(`[PDF] Done: ${fullText.length} total chars`);
  return { text: fullText.trim(), chunks };
};

const parseText = async (file: File): Promise<ParsedDocument> => {
  const text = await file.text();

  if (!text || text.trim().length === 0) {
    throw new Error('File is empty');
  }

  console.log(`[Text] Done: ${text.length} chars`);
  return {
    text: text.trim(),
    chunks: [{ text: text.trim(), page: 1 }]
  };
};

export const createChunks = (text: string, page: number, chunkSize = 500, overlap = 50) => {
  if (!text || text.trim().length === 0) return [];

  const words = text.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return [];

  if (words.length <= chunkSize) {
    return [{ text: words.join(' '), metadata: { page } }];
  }

  const chunks = [];
  for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.length > 0) {
      chunks.push({
        text: chunk,
        metadata: { page, chunkIndex: chunks.length } // Add chunkIndex for context
      });
    }
  }

  console.log(`[Chunks] Page ${page}: ${chunks.length} chunks`);
  return chunks;
};