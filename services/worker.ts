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

// ========== TF-IDF Sentence Scoring ==========
const tfidfSentenceScore = (
  sentence: string,
  queryTokens: Set<string>,
  allSentences: string[]
): number => {
  const sentTokens = tokenize(sentence);
  if (sentTokens.length === 0) return 0;

  let score = 0;
  for (const qt of queryTokens) {
    if (!sentTokens.includes(qt)) continue;
    // TF in sentence
    const tf = sentTokens.filter(t => t === qt).length / sentTokens.length;
    // IDF across all sentences
    const docsWithTerm = allSentences.filter(s => tokenize(s).includes(qt)).length;
    const idf = Math.log((allSentences.length + 1) / (docsWithTerm + 1)) + 1;
    score += tf * idf;
  }
  // Normalize by query size
  return score / Math.sqrt(queryTokens.size);
};

// ========== Query Expansion for Implicit Intents ==========
const QUERY_EXPANSIONS: Record<string, string> = {
  // Identity queries
  'name': 'name full name person author candidate resume cv profile',
  'who': 'name person author candidate identity profile about',
  'contact': 'email phone address contact information linkedin github',
  'email': 'email mail contact address gmail',
  'phone': 'phone telephone mobile number contact',
  
  // Professional queries
  'experience': 'experience work job position role employment history professional',
  'education': 'education degree university college school academic qualification',
  'skills': 'skills technologies programming languages frameworks tools expertise',
  'projects': 'projects portfolio work built developed created implemented',
  'summary': 'summary objective profile about introduction overview',
  
  // Common short queries
  'location': 'location address city country based remote',
  'company': 'company employer organization worked employment',
  'title': 'title position role job designation',
  'languages': 'languages programming technologies stack frameworks',
};

const IDENTITY_PATTERNS = /^(name|who|what.*name|whose|author|person|candidate)$/i;
const FIRST_CHUNK_BOOST = 0.15; // Boost for first chunks on identity queries

const expandQuery = (query: string): string => {
  const normalized = query.toLowerCase().trim();
  
  // Direct match
  if (QUERY_EXPANSIONS[normalized]) {
    return `${query} ${QUERY_EXPANSIONS[normalized]}`;
  }
  
  // Partial match for compound queries
  for (const [key, expansion] of Object.entries(QUERY_EXPANSIONS)) {
    if (normalized.includes(key) && normalized.split(/\s+/).length <= 3) {
      return `${query} ${expansion}`;
    }
  }
  
  return query;
};

const isIdentityQuery = (query: string): boolean => {
  return IDENTITY_PATTERNS.test(query.trim());
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

      // 1. Query Expansion for implicit intents
      const expandedQuery = expandQuery(text);
      const isIdentity = isIdentityQuery(text);
      console.log(`[Worker] Original: "${text}" | Expanded: "${expandedQuery}" | Identity: ${isIdentity}`);

      // 2. Retrieval with expanded query
      const output = await pipe(expandedQuery, { pooling: 'mean', normalize: true });
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

      const scored = allChunks.map((chunk: any) => {
        let score = cosineSimilarity(queryVector, chunk.embedding);
        
        // Boost first chunks for identity queries (name, contact info usually at top)
        if (isIdentity && chunk.metadata?.chunkIndex === 0) {
          score += FIRST_CHUNK_BOOST;
        }
        // Also boost page 1, first few chunks for identity
        if (isIdentity && chunk.metadata?.page === 1 && (chunk.metadata?.chunkIndex ?? 0) < 2) {
          score += FIRST_CHUNK_BOOST * 0.5;
        }
        
        return { ...chunk, score };
      }).sort((a: any, b: any) => b.score - a.score);

      const topK = scored.slice(0, 8);

      const queryTokens = new Set(tokenize(text));
      const queryTokensArr = Array.from(queryTokens);

      // ========== Improved Extractive Answer with TF-IDF ==========
      const buildExtractiveAnswer = (sources: any[]) => {
        const sentenceSplit = (s: string) => s.split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
        const allSentences: string[] = [];
        const sentenceMap: { sentence: string; sourceId: string }[] = [];

        sources.forEach((s: any) => {
          const sentences = sentenceSplit(s.text || '');
          sentences.forEach(sentence => {
            if (sentence.length > 20) { // Filter very short sentences
              allSentences.push(sentence);
              sentenceMap.push({ sentence, sourceId: s.sourceId });
            }
          });
        });

        const scoredSentences = sentenceMap.map(({ sentence, sourceId }) => ({
          sentence,
          sourceId,
          score: tfidfSentenceScore(sentence, queryTokens, allSentences)
        })).filter(s => s.score > 0);

        scoredSentences.sort((a, b) => b.score - a.score);

        // Pick top sentences with diversity (avoid near-duplicates)
        const picked: typeof scoredSentences = [];
        for (const s of scoredSentences) {
          if (picked.length >= 3) break;
          const isDuplicate = picked.some(p => {
            const overlap = tokenize(p.sentence).filter(t => tokenize(s.sentence).includes(t)).length;
            return overlap / Math.min(tokenize(p.sentence).length, tokenize(s.sentence).length) > 0.6;
          });
          if (!isDuplicate) picked.push(s);
        }

        if (picked.length === 0) return null;
        return picked.map(p => `${p.sentence} [${p.sourceId}]`).join(' ');
      };

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

      // ========== Special Handler for Identity Queries ==========
      const extractIdentityInfo = (sources: any[]): string | null => {
        // For identity queries, look at the beginning of documents
        const firstChunks = sources.filter((s: any) => 
          s.metadata?.chunkIndex === 0 || 
          (s.metadata?.page === 1 && (s.metadata?.chunkIndex ?? 0) < 2)
        );
        
        if (firstChunks.length === 0 && sources.length > 0) {
          firstChunks.push(sources[0]); // Fallback to first source
        }
        
        for (const chunk of firstChunks) {
          const text = chunk.text || '';
          const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
          
          // Names are often the first non-empty line in resumes/CVs
          // They're typically short (1-4 words) and don't contain common resume keywords
          const skipPatterns = /^(resume|cv|curriculum|summary|objective|experience|education|skills|contact|address|email|phone|profile)/i;
          
          for (const line of lines.slice(0, 5)) { // Check first 5 lines
            const wordCount = line.split(/\s+/).length;
            // Name heuristic: 1-4 words, no common headers, mostly letters
            if (wordCount >= 1 && wordCount <= 4 && 
                !skipPatterns.test(line) && 
                /^[A-Za-z\s.\-']+$/.test(line) &&
                line.length >= 3 && line.length <= 50) {
              return `${line} [${chunk.sourceId}]`;
            }
          }
        }
        return null;
      };

      // If retrieval confidence is too low, avoid answering
      const topScore = labeledSources[0]?.combinedScore ?? 0;
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
      
      // Lower threshold for identity queries - we have structural heuristics
      const minScore = isIdentity ? 0.01 : (wordCount <= 3 ? 0.08 : 0.18);
      
      if (topScore < minScore) {
        // Try identity extraction first for identity queries
        if (isIdentity) {
          const identityAnswer = extractIdentityInfo(labeledSources);
          if (identityAnswer) {
            self.postMessage({ type: 'retrieval_done', payload: { sources: labeledSources } });
            self.postMessage({
              type: 'query_result',
              payload: { answer: identityAnswer, sources: labeledSources }
            });
            return;
          }
        }
        
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
      
      // For identity queries with sufficient score, still try extraction first
      if (isIdentity) {
        const identityAnswer = extractIdentityInfo(labeledSources);
        if (identityAnswer) {
          self.postMessage({ type: 'retrieval_done', payload: { sources: labeledSources } });
          self.postMessage({
            type: 'query_result',
            payload: { answer: identityAnswer, sources: labeledSources }
          });
          return;
        }
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