import { openDB, IDBPDatabase } from 'idb';
import { DB_NAME, STORE_DOCUMENTS, STORE_CHUNKS } from '../constants';
import { DocumentMeta, Chunk } from '../types';

let dbPromise: Promise<IDBPDatabase> | null = null;

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          db.createObjectStore(STORE_DOCUMENTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          db.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

export const addDocument = async (doc: DocumentMeta) => {
  const db = await getDB();
  return db.put(STORE_DOCUMENTS, doc);
};

export const getDocuments = async (): Promise<DocumentMeta[]> => {
  const db = await getDB();
  return db.getAll(STORE_DOCUMENTS);
};

export const deleteDocument = async (id: string) => {
  const db = await getDB();
  // Delete doc
  await db.delete(STORE_DOCUMENTS, id);
  // Delete chunks - This is inefficient in raw IDB without an index on docId, 
  // but for a hackathon demo with small data it's fine.
  // Ideally we use an index.
  const allChunks = await db.getAll(STORE_CHUNKS);
  const chunksToDelete = allChunks.filter((c: Chunk) => c.docId === id);
  const tx = db.transaction(STORE_CHUNKS, 'readwrite');
  await Promise.all(chunksToDelete.map((c: Chunk) => tx.store.delete(c.id)));
  await tx.done;
};
