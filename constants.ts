// Models
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
// Using LaMini as a reliable browser-ready fallback for Phi-3 which can be heavy/unstable in some previews
// In a full prod env, 'Xenova/Phi-3-mini-4k-instruct' would be the target.
export const GENERATION_MODEL = 'Xenova/LaMini-Flan-T5-783M'; 

// Database
export const DB_NAME = 'mangeton_db';
export const DB_VERSION = 1;
export const STORE_DOCUMENTS = 'documents';
export const STORE_CHUNKS = 'chunks';

// RAG Config
export const CHUNK_SIZE = 500; // tokens approx
export const CHUNK_OVERLAP = 50;
export const TOP_K_RETRIEVAL = 3;