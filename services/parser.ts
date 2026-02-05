import * as pdfjsLib from 'pdfjs-dist';

// Initialize PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface ParsedDocument {
  text: string;
  chunks: { text: string; page: number }[];
}

export const parseFile = async (file: File): Promise<ParsedDocument> => {
  const fileType = file.type;

  try {
    if (fileType === 'application/pdf') {
      return await parsePDF(file);
    } else if (fileType === 'text/plain' || fileType.includes('text')) {
      return await parseText(file);
    } else {
      // Fallback - try as text
      console.warn(`Unknown file type: ${fileType}, attempting text parsing`);
      return await parseText(file);
    }
  } catch (error) {
    console.error('Error parsing file:', error);
    throw new Error(`Failed to parse file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const parsePDF = async (file: File): Promise<ParsedDocument> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    console.log(`PDF loaded: ${numPages} pages`);

    const chunks: { text: string; page: number }[] = [];
    let fullText = '';

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      // Better text extraction with proper spacing and line breaks
      let pageText = '';
      let lastY = -1;

      for (const item of textContent.items) {
        const textItem = item as any;

        // Check if we need a line break (new line detected)
        if (lastY !== -1 && Math.abs(textItem.transform[5] - lastY) > 5) {
          pageText += '\n';
        }

        // Add space if needed (check horizontal spacing)
        if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
          pageText += ' ';
        }

        pageText += textItem.str;
        lastY = textItem.transform[5];
      }

      // Clean up the text
      pageText = pageText
        .replace(/\s+/g, ' ')  // Normalize whitespace
        .replace(/\n\s+/g, '\n')  // Clean line breaks
        .trim();

      if (pageText.length > 0) {
        chunks.push({ text: pageText, page: pageNum });
        fullText += pageText + '\n\n';
        console.log(`Page ${pageNum}: ${pageText.length} characters extracted`);
      } else {
        console.warn(`Page ${pageNum}: No text extracted (might be image-based)`);
      }
    }

    if (fullText.trim().length === 0) {
      throw new Error('No text could be extracted from PDF. It might be a scanned document or image-based PDF.');
    }

    console.log(`Total text extracted: ${fullText.length} characters from ${chunks.length} pages`);
    return { text: fullText, chunks };

  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

const parseText = async (file: File): Promise<ParsedDocument> => {
  try {
    const text = await file.text();

    if (!text || text.trim().length === 0) {
      throw new Error('File is empty or contains no readable text');
    }

    console.log(`Text file loaded: ${text.length} characters`);

    return {
      text,
      chunks: [{ text, page: 1 }]
    };
  } catch (error) {
    console.error('Text parsing error:', error);
    throw new Error(`Text parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const createChunks = (text: string, page: number, chunkSize = 800, overlap = 100) => {
  if (!text || text.trim().length === 0) {
    console.warn(`Empty text for page ${page}, skipping chunking`);
    return [];
  }

  // Split by words, preserving some structure
  const words = text.split(/\s+/).filter(word => word.length > 0);
  const chunks = [];

  if (words.length === 0) {
    return [];
  }

  // If text is shorter than chunk size, return as single chunk
  if (words.length <= chunkSize) {
    return [{
      text: words.join(' '),
      metadata: { page, chunkIndex: 0, totalChunks: 1 }
    }];
  }

  // Create overlapping chunks
  let chunkIndex = 0;
  for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
    const chunkWords = words.slice(i, i + chunkSize);
    const chunkText = chunkWords.join(' ');

    if (chunkText.trim().length > 0) {
      chunks.push({
        text: chunkText,
        metadata: {
          page,
          chunkIndex,
          startWord: i,
          endWord: i + chunkWords.length
        }
      });
      chunkIndex++;
    }
  }

  console.log(`Created ${chunks.length} chunks from page ${page} (${words.length} words)`);
  return chunks;
};