import { pipeline, env } from '@xenova/transformers';
import { openDB } from 'idb';

// Configuration for Transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true; // Persist models in Cache API

const DB_NAME = 'mangeton_db';
const STORE_CHUNKS = 'chunks';
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
const GENERATION_MODEL = 'Xenova/flan-t5-base'; // ~240MB - Better quality, good balance

let embedder: any = null;
let generator: any = null;

// Helper to detect WebGPU availability in Worker context
const checkWebGPU = async () => {
  try {
    if (typeof navigator !== 'undefined' && (navigator as any).gpu) {
      const adapter = await (navigator as any).gpu.requestAdapter();
      return !!adapter;
    }
    return false;
  } catch (e) {
    return false;
  }
};

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
    const hasWebGPU = await checkWebGPU();
    console.log(`Loading Embedder. WebGPU available: ${hasWebGPU}`);

    embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      quantized: true,
      progress_callback: (data: any) => {
        if (progressCallback) {
          progressCallback({ ...data, task: 'embedder' });
        }
      }
    });
  }
  return embedder;
};

const getGenerator = async (progressCallback?: (data: any) => void) => {
  if (!generator) {
    const hasWebGPU = await checkWebGPU();
    console.log(`Loading Generator. WebGPU available: ${hasWebGPU}`);

    generator = await pipeline('text2text-generation', GENERATION_MODEL, {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      quantized: true,
      progress_callback: (data: any) => {
        if (progressCallback) {
          progressCallback({ ...data, task: 'generator' });
        }
      }
    });
  }
  return generator;
};

// Cosine similarity
const cosineSimilarity = (a: number[], b: number[]) => {
  let dot = 0;
  let normA = 0;
  let normB = 0;
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
      const progressCallback = (data: any) => {
        self.postMessage({ type: 'init_progress', payload: data });
      };

      await getEmbedder(progressCallback);
      await getGenerator(progressCallback);

      self.postMessage({ type: 'init_done' });
    } else if (type === 'ingest') {
      const { chunks, docId } = payload;
      const pipe = await getEmbedder();
      const db = await initDB();
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');

      const total = chunks.length;

      for (let i = 0; i < total; i++) {
        const chunk = chunks[i];
        const output = await pipe(chunk.text, { pooling: 'mean', normalize: true });
        const embedding = Array.from(output.data);

        await tx.store.put({
          id: `${docId}-${i}`,
          docId,
          text: chunk.text,
          metadata: chunk.metadata,
          embedding
        });

        if (i % 5 === 0) {
          self.postMessage({ type: 'ingest_progress', payload: { progress: (i / total) * 100 } });
        }
      }

      await tx.done;
      self.postMessage({ type: 'ingest_done' });

    } else if (type === 'query') {
      const { text } = payload;
      const pipe = await getEmbedder();
      const gen = await getGenerator();
      const db = await initDB();

      // 1. Embed query
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const queryVector = Array.from(output.data) as number[];

      // 2. Retrieve all chunks
      const allChunks = await db.getAll(STORE_CHUNKS);

      const scored = allChunks.map((chunk: any) => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.embedding)
      }));

      // 3. Top K - Always retrieve best chunks for reliability
      scored.sort((a: any, b: any) => b.score - a.score);
      const topK = scored.slice(0, 5); // Top 5 chunks

      // Debug logging
      console.log(`\n=== RAG Query ===`);
      console.log(`Query: "${text}"`);
      console.log(`Total chunks in DB: ${allChunks.length}`);
      console.log(`Top 5 scores:`, topK.map((c: any) => c.score.toFixed(3)));
      console.log(`Best match score: ${topK[0]?.score.toFixed(3) || 'N/A'}`);

      // 4. Generate with improved prompt
      const context = topK.map((c: any) => c.text).join('\n\n');

      // Enhanced prompt for better answers
      const prompt = `You are a helpful assistant. Answer the question based on the context provided. Be specific, accurate, and concise.

Context:
${context}

Question: ${text}

Answer:`;

      const response = await gen(prompt, {
        max_new_tokens: 256,
        temperature: 0.4,
        do_sample: true,
        top_k: 40,
        top_p: 0.9,
        repetition_penalty: 1.2
      });

      console.log(`Generated answer: "${response[0].generated_text}"`);
      console.log(`=================\n`);

      self.postMessage({
        type: 'query_result',
        payload: {
          answer: response[0].generated_text,
          sources: topK
        }
      });
    }
  } catch (err: any) {
    console.error(err);
    self.postMessage({ type: 'error', payload: err.message });
  }
});