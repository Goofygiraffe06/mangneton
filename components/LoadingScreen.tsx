import React from 'react';
import { Loader2, ShieldCheck, Database, Cpu } from 'lucide-react';

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
    // Dynamic averaging: Use a higher divisor as more files are discovered
    // This prevents jumps when a new file (0%) starts
    const divisor = Math.max(items.length, 5); // Assume at least 5 files

    const calculated = Math.min(Math.round(total / divisor), 100);

    // Monotonicity check: Never return a lower value than we've seen
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
    <div className="fixed inset-0 bg-gray-900 z-50 flex flex-col items-center justify-center text-white p-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center justify-center p-4 bg-brand-600 rounded-2xl shadow-2xl shadow-brand-500/20 mb-4 animate-pulse">
            <ShieldCheck className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">MANGETON</h1>
          <p className="text-gray-400 text-sm">Initializing Secure Client-Side Environment</p>
        </div>

        <div className="bg-gray-800 rounded-xl p-6 shadow-xl border border-gray-700 space-y-6">
          {/* Main Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm font-medium">
              <span className="text-gray-300">System Initialization</span>
              <span className="text-brand-400">{globalProgress}%</span>
            </div>
            <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 transition-all duration-300 ease-out"
                style={{ width: `${globalProgress}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 pt-4 border-t border-gray-700/50">
            {/* Embedder Status */}
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${safeEmbedderTotal === 100 ? 'bg-green-500/10 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                <Database className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-gray-300">Embedding Model</span>
                  <span className="text-gray-500">{safeEmbedderTotal === 100 ? 'Ready' : `${safeEmbedderTotal}%`}</span>
                </div>
                {safeEmbedderTotal < 100 && (
                  <div className="h-1 w-full bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${safeEmbedderTotal}%` }} />
                  </div>
                )}
              </div>
            </div>

            {/* Generator Status */}
            <div className="flex items-center space-x-3">
              <div className={`p-2 rounded-lg ${safeGeneratorTotal === 100 ? 'bg-green-500/10 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                <Cpu className="w-4 h-4" />
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium text-gray-300">Generation Model (LLM)</span>
                  <span className="text-gray-500">{safeGeneratorTotal === 100 ? 'Ready' : `${safeGeneratorTotal}%`}</span>
                </div>
                {safeGeneratorTotal < 100 && (
                  <div className="h-1 w-full bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500 transition-all duration-300" style={{ width: `${safeGeneratorTotal}%` }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Caching weights to local storage for offline use...</span>
          </div>
          <p className="text-[10px] text-gray-600">
            Hardware acceleration (WebGPU/WASM) enabled
          </p>
        </div>
      </div>
    </div>
  );
};