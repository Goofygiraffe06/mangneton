import React from 'react';
import { Loader2, Pentagon, Database, Cpu } from 'lucide-react';

interface ProgressItem {
  file: string;
  progress: number;
}

interface LoadingScreenProps {
  embedderProgress: ProgressItem[];
  generatorProgress: ProgressItem[];
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({
  embedderProgress,
  generatorProgress
}) => {
  // State to track max progress to prevent backward jumping
  const [safeEmbedderTotal, setSafeEmbedderTotal] = React.useState(0);
  const [safeGeneratorTotal, setSafeGeneratorTotal] = React.useState(0);

  // Helper to calculate total percentage for a model
  const calculateTotalProgress = (items: ProgressItem[], currentSafe: number) => {
    if (items.length === 0) return currentSafe;

    const total = items.reduce((acc, item) => acc + item.progress, 0);
    // Dynamic averaging
    const divisor = Math.max(items.length, 5);
    const calculated = Math.min(Math.round(total / divisor), 100);
    return Math.max(calculated, currentSafe);
  };

  React.useEffect(() => {
    setSafeEmbedderTotal(prev => calculateTotalProgress(embedderProgress, prev));
  }, [embedderProgress]);

  React.useEffect(() => {
    setSafeGeneratorTotal(prev => calculateTotalProgress(generatorProgress, prev));
  }, [generatorProgress]);

  // Calculate global progress
  const globalProgress = Math.round((safeEmbedderTotal * 0.2) + (safeGeneratorTotal * 0.8));

  return (
    <div className="fixed inset-0 bg-zinc-950 z-50 flex flex-col items-center justify-center text-white p-4 font-sans">
      <div className="max-w-sm w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-3 bg-white rounded-xl shadow-2xl mb-2">
            <Pentagon className="w-8 h-8 text-black fill-black" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">mangeton</h1>
          <p className="text-zinc-500 text-sm font-medium">Setting up your local AI...</p>
        </div>

        <div className="bg-zinc-900/50 rounded-lg p-6 border border-zinc-800 space-y-6 backdrop-blur-sm">
          {/* Main Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-medium uppercase tracking-wider">
              <span className="text-zinc-500">System Ready</span>
              <span className="text-zinc-300">{globalProgress}%</span>
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-white transition-all duration-300 ease-out"
                style={{ width: `${globalProgress}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 pt-3 border-t border-zinc-800">
            {/* Embedder Status */}
            <div className="flex items-center space-x-3">
              <div className={`p-1.5 rounded-md ${safeEmbedderTotal === 100 ? 'bg-zinc-800 text-white' : 'bg-transparent text-zinc-600'}`}>
                <Database className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-[10px] uppercase font-semibold">
                  <span className="text-zinc-400">Embedder</span>
                  <span className="text-zinc-500">{safeEmbedderTotal === 100 ? 'DONE' : `${safeEmbedderTotal}%`}</span>
                </div>
                {safeEmbedderTotal < 100 && (
                  <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-zinc-600 transition-all duration-300" style={{ width: `${safeEmbedderTotal}%` }} />
                  </div>
                )}
              </div>
            </div>

            {/* Generator Status */}
            <div className="flex items-center space-x-3">
              <div className={`p-1.5 rounded-md ${safeGeneratorTotal === 100 ? 'bg-zinc-800 text-white' : 'bg-transparent text-zinc-600'}`}>
                <Cpu className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-[10px] uppercase font-semibold">
                  <span className="text-zinc-400">LLM Engine</span>
                  <span className="text-zinc-500">{safeGeneratorTotal === 100 ? 'DONE' : `${safeGeneratorTotal}%`}</span>
                </div>
                {safeGeneratorTotal < 100 && (
                  <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-zinc-600 transition-all duration-300" style={{ width: `${safeGeneratorTotal}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs text-zinc-500">
            {globalProgress < 100 && <Loader2 className="w-3 h-3 animate-spin" />}
            <span className="font-mono">
              {globalProgress < 100
                ? 'Downloading weights...'
                : 'Ready.'}
            </span>
          </div>
          <p className="text-[10px] text-zinc-600">
            ~300MB download required once.
          </p>
        </div>
      </div>
    </div>
  );
};