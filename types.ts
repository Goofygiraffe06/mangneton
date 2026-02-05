export interface DocumentMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadDate: number;
  chunkCount: number;
  processed: boolean;
}

export interface Chunk {
  id: string;
  docId: string;
  text: string;
  metadata: {
    page?: number;
    loc?: { lines: { from: number; to: number } };
  };
  embedding?: number[];
}

export interface SearchResult extends Chunk {
  score: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: SearchResult[];
  isThinking?: boolean;
}

export type PipelineStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ProcessingStatus = 'idle' | 'parsing' | 'embedding' | 'complete' | 'error';

export interface WorkerMessage {
  type: 'init' | 'ingest' | 'query' | 'status';
  payload?: any;
}

export interface InitProgressPayload {
  task: 'embedder' | 'generator';
  status: 'initiate' | 'download' | 'progress' | 'done';
  file?: string;
  name?: string;
  progress?: number; // 0 to 100
  loaded?: number;
  total?: number;
}

export interface WorkerResponse {
  type: 'init_done' | 'init_progress' | 'ingest_progress' | 'ingest_done' | 'query_result' | 'error';
  payload?: any;
}