
import React, { useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { Send, User, Sparkles, FileSearch, ArrowUp } from 'lucide-react';
import { Button } from './ui/Button';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isLoading: boolean;
  modelStatus: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isLoading,
  modelStatus
}) => {
  const [input, setInput] = React.useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-white relative font-sans text-zinc-900">
      {/* Header - Transparent/Glass */}
      <div className="h-16 flex items-center justify-between px-8 absolute top-0 w-full z-20 pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2 bg-white/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/20 shadow-sm mt-4">
          <span className="font-semibold text-xs tracking-tight text-zinc-800">Llama3 / Qwen</span>
          <span className="text-zinc-300">|</span>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_8px_currentColor] ${modelStatus === 'ready' ? 'bg-green-500 text-green-500' : 'bg-amber-500 text-amber-500 animate-pulse'}`} />
            <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{modelStatus === 'ready' ? 'Online' : 'Loading'}</span>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto w-full pt-28">
        <div className="max-w-3xl mx-auto px-6 pb-8 space-y-12">
          {messages.length === 0 && (
            <div className="h-[50vh] flex flex-col items-center justify-center text-center space-y-8 animate-fade-in opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/20 to-purple-500/20 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-zinc-100 relative z-10">
                  <Sparkles className="w-8 h-8 text-zinc-800" strokeWidth={1.5} />
                </div>
              </div>
              <div className="space-y-3 max-w-md">
                <h3 className="text-2xl font-semibold text-zinc-900 tracking-tight">How can I help you?</h3>
                <p className="text-zinc-500 text-base leading-relaxed">
                  I can analyze your documents privately and securely, offline.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-6 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'} group animate-slide-up`}
            >
              {/* Avatar */}
              <div className="flex-shrink-0 mt-1">
                {msg.role === 'user' ? (
                  <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center shadow-lg shadow-zinc-900/10">
                    <User className="w-4 h-4 text-zinc-100" strokeWidth={1.5} />
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-full bg-white border border-zinc-200 flex items-center justify-center shadow-sm">
                    <Sparkles className="w-4 h-4 text-zinc-800" strokeWidth={1.5} />
                  </div>
                )}
              </div>

              <div className={`flex-1 overflow-hidden space-y-3 max-w-[85%] ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {/* Message Content */}
                <div
                  className={`prose prose-zinc prose-p:leading-relaxed prose-pre:bg-zinc-50 prose-pre:border prose-pre:border-zinc-100 prose-sm max-w-none inline-block text-[15px] ${msg.role === 'user'
                    ? 'text-zinc-800 bg-zinc-50/50 px-5 py-3 rounded-2xl rounded-tr-sm border border-zinc-100'
                    : 'text-zinc-700'
                    }`}
                >
                  {msg.content || <span className="animate-pulse text-zinc-400">Thinking...</span>}
                </div>

                {/* Sources - Only for Bot */}
                {msg.role === 'assistant' && msg.sources && msg.sources.length > 0 && (
                  <div className="mt-4">
                    <div className="flex gap-2 mb-3">
                      {msg.sources.map((_, i) => (
                        <div key={i} className="h-1 flex-1 rounded-full bg-zinc-100 overflow-hidden">
                          <div className="h-full bg-zinc-300" style={{ width: `${(_.score * 100)}%` }} />
                        </div>
                      ))}
                    </div>
                    <details className="group/details">
                      <summary className="inline-flex items-center gap-2 text-xs font-semibold text-zinc-500 hover:text-zinc-800 cursor-pointer select-none transition-colors uppercase tracking-wider">
                        <FileSearch className="w-3.5 h-3.5" />
                        <span>{msg.sources.length} Context Sources</span>
                      </summary>
                      <div className="mt-3 grid gap-3">
                        {msg.sources.map((source, idx) => (
                          <div key={idx} className="bg-white border border-zinc-100 rounded-xl p-4 text-xs text-left shadow-[0_2px_10px_rgb(0,0,0,0.02)] hover:shadow-md transition-shadow">
                            <div className="flex justify-between items-center mb-2 text-zinc-400">
                              <span className="font-semibold text-zinc-900 bg-zinc-100 px-2 py-0.5 rounded text-[10px]">SOURCE {idx + 1}</span>
                              <div className="font-mono">{(source.score * 100).toFixed(0)}% MATCH</div>
                            </div>
                            <div className="text-zinc-600 leading-relaxed border-l-2 border-zinc-200 pl-3">
                              "{source.text}"
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-6 flex-row animate-fade-in pl-14">
              <div className="flex gap-1.5 items-center h-8">
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>
      </div>

      {/* Input Area - Floating Island */}
      <div className="p-6 pb-8 bg-gradient-to-t from-white via-white to-transparent pointer-events-none sticky bottom-0 z-20">
        <div className="max-w-3xl mx-auto pointer-events-auto">
          <form onSubmit={handleSubmit} className="relative group">
            {/* Glow effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-zinc-200 to-zinc-200 rounded-[20px] blur opacity-20 group-focus-within:opacity-50 transition duration-500" />

            <div className="relative flex items-end gap-3 bg-white border border-zinc-200/80 rounded-[18px] p-2 pr-2 shadow-[0_8px_30px_rgb(0,0,0,0.04)] focus-within:shadow-[0_8px_30px_rgb(0,0,0,0.08)] focus-within:border-zinc-300 transition-all duration-300">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask anything..."
                className="flex-1 bg-transparent border-none focus:ring-0 text-zinc-900 placeholder-zinc-400 px-4 py-3.5 max-h-48 overflow-y-auto resize-none text-[15px]"
                disabled={isLoading || modelStatus !== 'ready'}
                autoFocus
              />
              <Button
                type="submit"
                disabled={!input.trim() || isLoading || modelStatus !== 'ready'}
                className="mb-1 rounded-xl w-10 h-10 p-0 flex items-center justify-center bg-zinc-900 hover:bg-black text-white shrink-0 transition-all disabled:opacity-0 disabled:scale-75 shadow-lg shadow-zinc-900/20 active:scale-95"
              >
                <ArrowUp className="w-5 h-5" strokeWidth={2.5} />
              </Button>
            </div>
          </form>
          <div className="text-center mt-4 opacity-0 group-focus-within:opacity-100 transition-opacity duration-500">
            {/* Optional footer text if needed, keeping it clean for now */}
          </div>
        </div>
      </div>
    </div>
  );
};