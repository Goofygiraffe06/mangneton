import React, { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Sidebar } from './components/Sidebar';
import { ChatInterface } from './components/ChatInterface';
import { LoadingScreen } from './components/LoadingScreen';
import { parseFile, createChunks } from './services/parser';
import * as db from './services/db';
import { DocumentMeta, ChatMessage, WorkerResponse, InitProgressPayload } from './types';

// Web Worker Initialization
const createWorker = () => new Worker(new URL('./services/worker.ts', import.meta.url), { type: 'module' });

export default function App() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Loading State
  const [embedderProgress, setEmbedderProgress] = useState<{ file: string, progress: number }[]>([]);
  const [generatorProgress, setGeneratorProgress] = useState<{ file: string, progress: number }[]>([]);

  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Initialize Worker and DB
    const init = async () => {
      const docs = await db.getDocuments();
      setDocuments(docs);

      workerRef.current = createWorker();

      workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const { type, payload } = e.data;

        switch (type) {
          case 'init_progress':
            handleInitProgress(payload as InitProgressPayload);
            break;
          case 'init_done':
            setModelStatus('ready');
            break;
          case 'ingest_progress':
            setProcessingProgress(payload.progress);
            break;
          case 'ingest_done':
            setIsProcessing(false);
            setProcessingProgress(0);
            refreshDocs();
            setMessages(prev => [...prev, {
              id: uuidv4(),
              role: 'system',
              content: 'Document processed successfully. You can now ask questions.',
              timestamp: Date.now()
            }]);
            break;
          case 'retrieval_done':
            // Show sources immediately while thinking
            setMessages(prev => {
              const lastMsg = prev[prev.length - 1];
              // If we already have a placeholder assistant message (from initial send? no we usually don't)
              // Actually we usually just have user message. We need to create the assistant placeholder here.

              return [...prev, {
                id: uuidv4(),
                role: 'assistant',
                content: '', // Empty content for now, will stream in
                sources: payload.sources,
                timestamp: Date.now()
              }];
            });
            break;
          case 'stream_update':
            // Handle streaming text
            setMessages(prev => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                return prev.map(msg => msg.id === lastMsg.id ? { ...msg, content: payload } : msg);
              } else {
                // Fallback if retrieval_done didn't fire for some reason (unlikely)
                return [...prev, {
                  id: uuidv4(),
                  role: 'assistant',
                  content: payload,
                  timestamp: Date.now()
                }];
              }
            });
            break;
          case 'query_result':
            // Final update, just ensure consistency
            setMessages(prev => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                return prev.map(msg => msg.id === lastMsg.id ? {
                  ...msg,
                  content: payload.answer,
                  sources: payload.sources
                } : msg);
              }
              // This fallback should rarely happen now
              return [...prev, {
                id: uuidv4(),
                role: 'assistant',
                content: payload.answer,
                sources: payload.sources,
                timestamp: Date.now()
              }];
            });
            break;
          case 'error':
            console.error("Worker Error:", payload);
            setIsProcessing(false);
            setModelStatus('error');
            break;
        }
      };

      // Trigger model loading
      workerRef.current.postMessage({ type: 'init' });
    };

    init();

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const handleInitProgress = (payload: InitProgressPayload) => {
    if (payload.status === 'progress' || payload.status === 'download') {
      const updateFn = payload.task === 'embedder' ? setEmbedderProgress : setGeneratorProgress;

      updateFn(prev => {
        const exists = prev.find(p => p.file === payload.file);
        if (exists) {
          return prev.map(p => p.file === payload.file ? { ...p, progress: payload.progress || 0 } : p);
        } else {
          return [...prev, { file: payload.file || 'model', progress: payload.progress || 0 }];
        }
      });
    } else if (payload.status === 'done') {
      // Ensure file is marked 100%
      const updateFn = payload.task === 'embedder' ? setEmbedderProgress : setGeneratorProgress;
      updateFn(prev => {
        const exists = prev.find(p => p.file === payload.file);
        if (exists) {
          return prev.map(p => p.file === payload.file ? { ...p, progress: 100 } : p);
        }
        return prev;
      });
    }
  };

  const refreshDocs = async () => {
    const docs = await db.getDocuments();
    setDocuments(docs);
  };

  const handleUpload = async (files: FileList) => {
    setIsProcessing(true);
    setProcessingProgress(0);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const docId = uuidv4();

        // 1. Parse text (Main Thread)
        const { text, chunks: rawChunks } = await parseFile(file);

        // 2. Create optimized chunks (Main Thread)
        let allChunks: any[] = [];
        rawChunks.forEach(rc => {
          const pageChunks = createChunks(rc.text, rc.page);
          allChunks = [...allChunks, ...pageChunks];
        });

        // 3. Save Doc Meta
        const docMeta: DocumentMeta = {
          id: docId,
          name: file.name,
          size: file.size,
          type: file.type,
          uploadDate: Date.now(),
          chunkCount: allChunks.length,
          processed: false // Will be true after worker finishes
        };
        await db.addDocument(docMeta);

        // 4. Send to Worker for Embedding & Storage
        workerRef.current?.postMessage({
          type: 'ingest',
          payload: { chunks: allChunks, docId }
        });

        // Add system message
        setMessages(prev => [...prev, {
          id: uuidv4(),
          role: 'system',
          content: `Uploaded ${file.name}. Processing content...`,
          timestamp: Date.now()
        }]);
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setIsProcessing(false);
      setMessages(prev => [...prev, {
        id: uuidv4(),
        role: 'system',
        content: `Error: ${err?.message || 'Failed to process files'}`,
        timestamp: Date.now()
      }]);
    }
  };

  const handleDelete = async (id: string) => {
    await db.deleteDocument(id);
    await refreshDocs();
  };

  const handleSendMessage = (text: string) => {
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    };
    setMessages(prev => [...prev, userMsg]);

    workerRef.current?.postMessage({
      type: 'query',
      payload: { text }
    });
  };

  const addBotMessage = (text: string, sources: any[]) => {
    const botMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: text,
      timestamp: Date.now(),
      sources
    };
    setMessages(prev => [...prev, botMsg]);
  };

  const isGenerating = messages.length > 0 && messages[messages.length - 1].role === 'user';

  return (
    <>
      {modelStatus === 'loading' && (
        <LoadingScreen
          embedderProgress={embedderProgress}
          generatorProgress={generatorProgress}
        />
      )}

      <div className="flex h-screen bg-zinc-50 overflow-hidden">
        <Sidebar
          documents={documents}
          onUpload={handleUpload}
          onDelete={handleDelete}
          isProcessing={isProcessing}
          processingProgress={processingProgress}
        />
        <main className="flex-1 flex flex-col h-full relative">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isGenerating}
            modelStatus={modelStatus}
          />
        </main>
      </div>
    </>
  );
}