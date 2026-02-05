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

// ========== BM25 Implementation ==========
const BM25_K1 = 1.5;
const BM25_B = 0.75;

const tokenize = (text: string): string[] => {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
};

const computeIDF = (term: string, docs: string[][]): number => {
  const docsWithTerm = docs.filter(d => d.includes(term)).length;
  if (docsWithTerm === 0) return 0;
  return Math.log((docs.length - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
};

const bm25Score = (
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  idfMap: Map<string, number>
): number => {
  const docLen = docTokens.length;
  const termFreq = new Map<string, number>();
  docTokens.forEach(t => termFreq.set(t, (termFreq.get(t) || 0) + 1));

  let score = 0;
  for (const term of queryTokens) {
    const tf = termFreq.get(term) || 0;
    const idf = idfMap.get(term) || 0;
    const numerator = tf * (BM25_K1 + 1);
    const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen));
    score += idf * (numerator / denominator);
  }
  return score;
};

// ========== Reciprocal Rank Fusion ==========
const RRF_K = 60; // Standard RRF constant

const reciprocalRankFusion = (rankings: { id: string; rank: number }[][]): Map<string, number> => {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (const { id, rank } of ranking) {
      const rrfScore = 1 / (RRF_K + rank);
      scores.set(id, (scores.get(id) || 0) + rrfScore);
    }
  }
  return scores;
};

// ========== MMR (Maximal Marginal Relevance) ==========
const MMR_LAMBDA = 0.7; // Balance relevance vs diversity

const mmrRerank = (
  candidates: any[],
  queryVector: number[],
  k: number
): any[] => {
  if (candidates.length <= k) return candidates;

  const selected: any[] = [];
  const remaining = [...candidates];

  // Always pick the most relevant first
  selected.push(remaining.shift()!);

  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relevance = candidate.combinedScore || 0;

      // Max similarity to already selected docs
      let maxSim = 0;
      for (const sel of selected) {
        const sim = cosineSimilarity(candidate.embedding, sel.embedding);
        if (sim > maxSim) maxSim = sim;
      }

      // MMR score: balance relevance and diversity
      const mmrScore = MMR_LAMBDA * relevance - (1 - MMR_LAMBDA) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
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

      // 1. Embed the query
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      const queryVector = Array.from(output.data) as number[];

      // 2. Retrieve from cache/DB
      if (!chunkCache) {
        const db = await initDB();
        chunkCache = await db.getAll(STORE_CHUNKS);
      }

      const allChunks = chunkCache || [];

      if (allChunks.length === 0) {
        self.postMessage({
          type: 'query_result',
          payload: { answer: 'No documents loaded. Please upload a document first.', sources: [] }
        });
        return;
      }

      // 3. Score by cosine similarity
      const scored = allChunks.map((chunk: any) => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.embedding)
      })).sort((a: any, b: any) => b.score - a.score);

      const topK = scored.slice(0, 8);

      const queryTokens = new Set(tokenize(text));
      const queryTokensArr = Array.from(queryTokens);

      // ========== BM25 Scoring ==========
      const allDocTokens = topK.map((c: any) => tokenize(c.text || ''));
      const avgDocLen = allDocTokens.reduce((sum, d) => sum + d.length, 0) / (allDocTokens.length || 1);

      // Pre-compute IDF for query terms
      const idfMap = new Map<string, number>();
      queryTokensArr.forEach(term => {
        idfMap.set(term, computeIDF(term, allDocTokens));
      });

      const withBM25 = topK.map((chunk: any, idx: number) => {
        const docTokens = allDocTokens[idx];
        const bm25 = bm25Score(queryTokensArr, docTokens, avgDocLen, idfMap);
        return { ...chunk, bm25Score: bm25 };
      });

      // ========== Reciprocal Rank Fusion ==========
      // Rank by semantic score
      const semanticRanking = [...withBM25]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .map((c, i) => ({ id: c.id, rank: i + 1 }));

      // Rank by BM25 score
      const bm25Ranking = [...withBM25]
        .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0))
        .map((c, i) => ({ id: c.id, rank: i + 1 }));

      // Fuse rankings
      const rrfScores = reciprocalRankFusion([semanticRanking, bm25Ranking]);

      const combined = withBM25.map((chunk: any) => ({
        ...chunk,
        combinedScore: rrfScores.get(chunk.id) || 0
      })).sort((a: any, b: any) => b.combinedScore - a.combinedScore);

      // ========== MMR Reranking for Diversity ==========
      const diversified = mmrRerank(combined, queryVector, 8);

      const labeledSources = diversified.map((chunk: any, idx: number) => ({
        ...chunk,
        sourceId: `S${idx + 1}`
      }));

      // Send sources immediately
      self.postMessage({
        type: 'retrieval_done',
        payload: { sources: labeledSources }
      });

      // 4. Build context for LLM
      let context = labeledSources.map((c: any) => {
        const pageInfo = c.metadata?.page ? `[Page ${c.metadata.page}]` : '';
        return `${c.text}`;
      }).join('\n\n');

      if (context.length > 3000) context = context.substring(0, 3000);

      // 5. Generate answer
      const prompt = `<|im_start|>system
You are a helpful assistant that answers questions based ONLY on the provided context. Rules:
- Answer in English ONLY
- Use ONLY information from the context
- If the answer is not in the context, say "I don't have that information"
- Do NOT make up or infer information
- Be direct and concise
<|im_end|>
<|im_start|>user
Context:
${context}

Question: ${text}<|im_end|>
<|im_start|>assistant
`;

      console.log(`[Worker] Prompt length: ${prompt.length}`);

      // 6. Generation with Streaming
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
              partial = partial.replace('<|im_end|>', '').replace('<|im_start|>', '');
              self.postMessage({ type: 'stream_update', payload: partial });
            } catch (e) { }
          }
        });

        let answer = response[0]?.generated_text || '';
        if (answer.startsWith(prompt)) {
          answer = answer.substring(prompt.length);
        }
        answer = answer.replace('<|im_end|>', '').trim();

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