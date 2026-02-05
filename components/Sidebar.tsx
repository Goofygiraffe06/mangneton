import React, { useRef } from 'react';
import { DocumentMeta } from '../types';
import { FileText, Plus, Trash2, CheckCircle, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

interface SidebarProps {
  documents: DocumentMeta[];
  onUpload: (files: FileList) => void;
  onDelete: (id: string) => void;
  isProcessing: boolean;
  processingProgress: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  documents,
  onUpload,
  onDelete,
  isProcessing,
  processingProgress,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUpload(e.target.files);
    }
    // Reset
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full flex-shrink-0">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center space-x-2 mb-6">
          <div className="bg-brand-600 p-2 rounded-lg">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <span className="font-bold text-xl text-gray-900 tracking-tight">MANGETON</span>
        </div>

        <Button
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Plus className="w-4 h-4" />
          Upload Documents
        </Button>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          accept=".pdf,.txt,.md"
          onChange={handleFileChange}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Knowledge Base
        </h3>

        {documents.length === 0 ? (
          <div className="text-center py-8 px-4 border-2 border-dashed border-gray-200 rounded-lg">
            <p className="text-sm text-gray-500">No documents yet.</p>
            <p className="text-xs text-gray-400 mt-1">Upload PDFs or Text files to start asking questions.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div key={doc.id} className="group flex items-start p-3 bg-gray-50 rounded-lg border border-transparent hover:border-gray-200 transition-all">
                <FileText className="w-5 h-5 text-brand-500 mt-0.5 flex-shrink-0" />
                <div className="ml-3 flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate" title={doc.name}>
                    {doc.name}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {(doc.size / 1024).toFixed(0)} KB • {doc.chunkCount} chunks
                  </p>
                </div>
                <button
                  onClick={() => onDelete(doc.id)}
                  className="ml-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {isProcessing && (
        <div className="p-4 bg-gradient-to-br from-brand-50 to-blue-50 border-t border-brand-100">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-brand-100">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
                  <div className="absolute inset-0 w-4 h-4 bg-brand-400 rounded-full animate-ping opacity-20" />
                </div>
                <span className="text-sm font-medium text-gray-700">Processing Document</span>
              </div>
              <span className="text-xs font-semibold text-brand-600 tabular-nums">
                {Math.round(processingProgress)}%
              </span>
            </div>

            {/* Progress Bar */}
            <div className="relative h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              {/* Actual progress */}
              <div
                className="relative h-full bg-gradient-to-r from-brand-500 via-brand-600 to-brand-500 rounded-full transition-all duration-500 ease-out shadow-sm"
                style={{ width: `${processingProgress}%` }}
              >
                {/* Glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent rounded-full animate-pulse" />
              </div>
            </div>

            {/* Status text */}
            <p className="text-[10px] text-gray-500 mt-2 text-center">
              Embedding content for semantic search...
            </p>
          </div>
        </div>
      )}

      <div className="p-4 border-t border-gray-200 text-xs text-center text-gray-400">
        <p className="flex items-center justify-center gap-1">
          <CheckCircle className="w-3 h-3 text-green-500" />
          Running 100% Client-Side
        </p>
      </div>
    </div>
  );
};