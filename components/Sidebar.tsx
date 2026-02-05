import React, { useRef } from 'react';
import { DocumentMeta } from '../types';
import { FileText, Plus, Trash2, CheckCircle, Loader2, Pentagon, Box } from 'lucide-react';
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
    <div className="w-[280px] bg-zinc-950 text-zinc-400 flex flex-col h-full flex-shrink-0 font-sans border-r border-zinc-900/50">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center shadow-sm shadow-zinc-900/20">
            <Pentagon className="w-5 h-5 text-black fill-black" strokeWidth={1.5} />
          </div>
          <span className="font-semibold text-lg text-zinc-100 tracking-tight">mangeton</span>
        </div>

        <Button
          className="w-full justify-start gap-3 bg-zinc-900 hover:bg-zinc-800 text-zinc-100 border border-zinc-800 h-10 rounded-lg transition-all font-medium text-sm hover:border-zinc-700 shadow-sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing}
        >
          <Plus className="w-4 h-4" strokeWidth={1.5} />
          <span>New Chat</span>
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

      {/* Documents List */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <div className="mb-3 px-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-widest">
          Context
        </div>

        {documents.length === 0 ? (
          <div className="text-center py-12 px-4 border border-dashed border-zinc-900/80 rounded-xl bg-zinc-900/20 mx-1">
            <Box className="w-6 h-6 text-zinc-700 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-xs text-zinc-600 font-medium">No documents added</p>
          </div>
        ) : (
          <div className="space-y-1">
            {documents.map((doc) => (
              <div key={doc.id} className="group relative flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg hover:bg-zinc-900/60 transition-all cursor-pointer text-zinc-400 hover:text-zinc-200">
                <FileText className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" strokeWidth={1.5} />
                <div className="flex-1 truncate font-medium">
                  {doc.name}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(doc.id); }}
                  className="absolute right-2 p-1.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="p-4 border-t border-zinc-900/50 bg-zinc-900/30 backdrop-blur-sm">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400 flex items-center gap-2 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />
                Processing
              </span>
              <span className="text-zinc-300 font-mono">{Math.round(processingProgress)}%</span>
            </div>
            <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-400 transition-all duration-300 ease-out"
                style={{ width: `${processingProgress}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};