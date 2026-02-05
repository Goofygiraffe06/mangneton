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

// Cache for vectors to speed up repeated searches
let chunkCache: any[] | null = null;

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

      // Invalidate cache on new ingest
      chunkCache = null;

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

      // 1. Retrieval
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const queryVector = Array.from(output.data) as number[];

      // Use cache if available, otherwise hit DB
      if (!chunkCache) {
        const db = await initDB();
        chunkCache = await db.getAll(STORE_CHUNKS);
      }

      const allChunks = chunkCache || [];

      if (allChunks.length === 0) {
        self.postMessage({
          type: 'query_result',
          payload: { answer: 'No documents found.', sources: [] }
        });
        return;
      }

      const scored = allChunks.map((chunk: any) => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.embedding)
      })).sort((a: any, b: any) => b.score - a.score);

      const topK = scored.slice(0, 8);

      const normalizeText = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const queryTokens = new Set(normalizeText(text).split(' ').filter(t => t.length > 2));

      const buildExtractiveAnswer = (sources: any[]) => {
        const sentenceSplit = (s: string) => s.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
        const scoredSentences: { sentence: string; score: number; sourceId: string }[] = [];
        sources.forEach((s: any) => {
          const sentences = sentenceSplit(s.text || '');
          sentences.forEach(sentence => {
            const tokens = new Set(normalizeText(sentence).split(' ').filter(t => t.length > 2));
            let overlap = 0;
            queryTokens.forEach(t => {
              if (tokens.has(t)) overlap += 1;
            });
            if (overlap > 0) {
              const score = queryTokens.size ? overlap / queryTokens.size : 0;
              scoredSentences.push({ sentence, score, sourceId: s.sourceId });
            }
          });
        });
        scoredSentences.sort((a, b) => b.score - a.score);
        const picked = scoredSentences.slice(0, 2);
        if (picked.length === 0) return null;
        const answer = picked.map(p => `${p.sentence} [${p.sourceId}]`).join(' ');
        return answer;
      };

      const withLexical = topK.map((chunk: any) => {
        const chunkText = chunk.text || '';
        const chunkTokens = new Set(normalizeText(chunkText).split(' ').filter(t => t.length > 2));
        let overlap = 0;
        queryTokens.forEach(t => {
          if (chunkTokens.has(t)) overlap += 1;
        });
        const lexicalScore = queryTokens.size ? overlap / queryTokens.size : 0;
        return { ...chunk, lexicalScore };
      });

      // Combine semantic + lexical
      const combined = withLexical.map((chunk: any) => {
        const semantic = chunk.score ?? 0;
        const lexical = chunk.lexicalScore ?? 0;
        const score = (semantic * 0.7) + (lexical * 0.3);
        return { ...chunk, combinedScore: score };
      }).sort((a: any, b: any) => b.combinedScore - a.combinedScore);

      const labeledSources = combined.map((chunk: any, idx: number) => ({
        ...chunk,
        sourceId: `S${idx + 1}`
      }));

      // If retrieval confidence is too low, avoid answering
      const topScore = labeledSources[0]?.combinedScore ?? 0;
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      const minScore = wordCount <= 3 ? 0.08 : 0.18;
      if (topScore < minScore) {
        const extractive = buildExtractiveAnswer(labeledSources);
        if (extractive) {
          self.postMessage({
            type: 'retrieval_done',
            payload: { sources: labeledSources }
          });
          self.postMessage({
            type: 'query_result',
            payload: { answer: extractive, sources: labeledSources }
          });
          return;
        }
        self.postMessage({
          type: 'query_result',
          payload: {
            answer: "I don't have that information in the provided documents.",
            sources: labeledSources
          }
        });
        return;
      }

      // FAST RESPONSE: Send sources immediately
      self.postMessage({
        type: 'retrieval_done',
        payload: { sources: labeledSources }
      });

      // Inject structural context
      let context = labeledSources.map((c: any) => {
        const pageInfo = c.metadata?.page ? `[Page ${c.metadata.page}]` : '';
        const orderInfo = c.metadata?.page === 1 && c.metadata?.chunkIndex === 0 ? '[Start of Document]' : '';
        return `[${c.sourceId}] ${orderInfo} ${pageInfo}\n${c.text}`;
      }).join('\n\n---\n\n');

      if (context.length > 2600) context = context.substring(0, 2600);

      // 3. Prompting
      const prompt = `<|im_start|>system
    You are a precise assistant. Use ONLY the context. If the answer is not explicitly in the context, reply: "I don't have that information in the provided documents." Do not guess or add facts. Keep answers concise. When you state a fact, include a citation in the form [S1], [S2], etc. Every factual sentence must end with a citation.
    <|im_end|>
    <|im_start|>user
    Context:
    ${context}

    Question: ${text}<|im_end|>
    <|im_start|>assistant
    `;

      console.log(`[Worker] Prompt length: ${prompt.length}`);
      // validation logic removed as we use manual prompt

      // 4. Generation with Streaming
      try {
        const response = await gen(prompt, {
          max_new_tokens: 256,
          temperature: 0.1,
          do_sample: false,
          repetition_penalty: 1.1,
          return_full_text: false,
          callback_function: (beams: any) => {
            try {
              const decoded = gen.tokenizer.decode(beams[0].output_ids, { skip_special_tokens: false });

              let partial = decoded;
              if (partial.startsWith(prompt)) {
                partial = partial.substring(prompt.length);
              }
              // Basic cleanup for the stream
              partial = partial.replace('<|im_end|>', '').replace('<|im_start|>', '');

              self.postMessage({
                type: 'stream_update',
                payload: partial
              });
            } catch (e) { }
          }
        });

        let answer = response[0]?.generated_text || '';
        // Final Cleanup
        if (answer.startsWith(prompt)) {
          answer = answer.substring(prompt.length);
        }
        answer = answer.replace('<|im_end|>', '').trim();
        answer = answer.replace(/^Answer:\s*/i, '');

        if (answer.toLowerCase().includes("i don't have that information") && answer.length > 50) {
          answer = "I don't have that information in the provided documents.";
        }

        // Ensure citations exist for factual answers; otherwise abstain
        const hasCitation = /\[S\d+\]/.test(answer);
        if (!hasCitation && !/i don't have that information/i.test(answer)) {
          const normalized = answer.replace(/\s+/g, ' ').trim();
          const shortAnswer = normalized.length > 0 && normalized.length <= 80;
          if (shortAnswer) {
            const matchIdx = labeledSources.findIndex((s: any) => s.text.includes(normalized));
            if (matchIdx >= 0) {
              answer = `${normalized} [S${matchIdx + 1}]`;
            } else {
              const extractive = buildExtractiveAnswer(labeledSources);
              answer = extractive || "I don't have that information in the provided documents.";
            }
          } else {
            const extractive = buildExtractiveAnswer(labeledSources);
            answer = extractive || "I don't have that information in the provided documents.";
          }
        }

        console.log('Qwen Answer:', answer);

        if (!answer) answer = "Could not generate answer.";

        self.postMessage({
          type: 'query_result',
          payload: { answer, sources: labeledSources }
        });

      } catch (err: any) {
        console.error("Gen Error:", err);
        // Fallback
        self.postMessage({
          type: 'query_result',
          payload: {
            answer: "I found relevant documents (see sources below), but couldn't generate a summary.",
            sources: labeledSources
          }
        });
      }
    }
  } catch (err: any) {
    console.error('Worker Error:', err);
    self.postMessage({ type: 'error', payload: err.message });
  }
});