import { pipeline, env } from '@xenova/transformers';
import { openDB } from 'idb';

env.allowLocalModels = false;
env.useBrowserCache = true;

const DB_NAME = 'mangeton_db';
const STORE_CHUNKS = 'chunks';
// BGE-Small is SOTA for small embeddings (better clustering/scores than MiniLM)
const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';

// Qwen1.5-0.5B-Chat is the best quality/size ratio available for browser
// ~390MB, very smart, fast
const GENERATION_MODEL = 'Xenova/Qwen1.5-0.5B-Chat';

let embedder: any = null;
let generator: any = null;

const initDB = async () => {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
      }
    },
  });
};

const getEmbedder = async (progressCallback?: (data: any) => void) => {
  if (!embedder) {
    embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      quantized: true,
      progress_callback: (data: any) => progressCallback?.({ ...data, task: 'embedder' })
    });
  }
  return embedder;
};

// Check WebGPU availability
const checkWebGPU = async () => {
  try {
    if ((navigator as any).gpu) {
      const adapter = await (navigator as any).gpu.requestAdapter();
      return !!adapter;
    }
  } catch (e) { }
  return false;
};

const getGenerator = async (progressCallback?: (data: any) => void) => {
  if (!generator) {
    const hasWebGPU = await checkWebGPU();
    console.log(`[Worker] Loading Qwen1.5-0.5B. WebGPU available: ${hasWebGPU}`);

    generator = await pipeline('text-generation', GENERATION_MODEL, {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      quantized: true,
      progress_callback: (data: any) => progressCallback?.({ ...data, task: 'generator' })
    } as any);
  }
  return generator;
};

const cosineSimilarity = (a: number[], b: number[]) => {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

self.addEventListener('message', async (e: MessageEvent) => {
  const { type, payload } = e.data;

  try {
    if (type === 'init') {
      const cb = (data: any) => self.postMessage({ type: 'init_progress', payload: data });
      await getEmbedder(cb);
      await getGenerator(cb);
      self.postMessage({ type: 'init_done' });

    } else if (type === 'ingest') {
      const { chunks, docId } = payload;
      const pipe = await getEmbedder();
      const db = await initDB();
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');

      for (let i = 0; i < chunks.length; i++) {
        const output = await pipe(chunks[i].text, { pooling: 'mean', normalize: true });
        await tx.store.put({
          id: `${docId}-${i}`,
          docId,
          text: chunks[i].text,
          metadata: chunks[i].metadata,
          embedding: Array.from(output.data)
        });
        if (i % 5 === 0) {
          self.postMessage({ type: 'ingest_progress', payload: { progress: (i / chunks.length) * 100 } });
        }
      }

      await tx.done;
      self.postMessage({ type: 'ingest_done' });

    } else if (type === 'query') {
      const { text } = payload;
      const pipe = await getEmbedder();
      const gen = await getGenerator();
      const db = await initDB();

      // 1. Retrieval
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const queryVector = Array.from(output.data) as number[];
      const allChunks = await db.getAll(STORE_CHUNKS);

      if (allChunks.length === 0) {
        self.postMessage({
          type: 'query_result',
          payload: { answer: 'No documents.', sources: [] }
        });
        return;
      }

      const scored = allChunks.map((chunk: any) => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.embedding)
      })).sort((a: any, b: any) => b.score - a.score);

      const topK = scored.slice(0, 3);

      // Inject structural context
      let context = topK.map((c: any) => {
        const pageInfo = c.metadata?.page ? `[Page ${c.metadata.page}]` : '';
        const orderInfo = c.metadata?.page === 1 && c.metadata?.chunkIndex === 0 ? '[Start of Document]' : '';
        return `${orderInfo} ${pageInfo}\n${c.text}`;
      }).join('\n\n---\n\n');

      if (context.length > 1500) context = context.substring(0, 1500);

      console.log(`Query: "${text}"`);

      // 3. Prompting (Simplified to prevent contradictions)
      // Removed specific "Say I don't have info" instruction to prevent "I don't have info. Answer: X"
      const prompt = `<|im_start|>system
You are a helpful AI assistant. Answer the user's question directly using the provided context.
- Be concise.
<|im_end|>
<|im_start|>user
Context:
${context}

Question: ${text}<|im_end|>
<|im_start|>assistant
`;

      // 4. Generation
      const response = await gen(prompt, {
        max_new_tokens: 256,
        temperature: 0.1,
        do_sample: false,
        repetition_penalty: 1.1,
        return_full_text: false
      });

      let answer = response[0]?.generated_text || '';
      if (answer.startsWith(prompt)) {
        answer = answer.substring(prompt.length);
      }

      answer = answer.replace('<|im_end|>', '').trim();

      // Post-processing cleanup
      // If it says "Answer: ...", strip the prefix
      answer = answer.replace(/^Answer:\s*/i, '');

      // If it has contradictory "I don't know" + real answer, prefer the answer
      if (answer.toLowerCase().includes("i don't have that information") && answer.length > 50) {
        answer = answer
          .replace(/I don't have that information\.?/gi, "")
          .trim();
      }

      console.log('Qwen Answer:', answer);

      if (!answer) answer = "Could not generate answer.";

      self.postMessage({
        type: 'query_result',
        payload: { answer, sources: topK }
      });
    }
  } catch (err: any) {
    console.error('Worker Error:', err);
    self.postMessage({ type: 'error', payload: err.message });
  }
});