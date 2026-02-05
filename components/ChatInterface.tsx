import React, { useRef, useEffect } from 'react';
import { ChatMessage } from '../types';
import { Send, User, Bot, FileSearch } from 'lucide-react';
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
    <div className="flex flex-col h-full bg-white relative">
      {/* Header */}
      <div className="h-16 border-b border-gray-100 flex items-center justify-between px-6 bg-white z-10">
        <h2 className="text-lg font-semibold text-gray-800">Secure Chat</h2>
        <div className="flex items-center gap-2">
           <span className={`inline-block w-2 h-2 rounded-full ${modelStatus === 'ready' ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}></span>
           <span className="text-xs text-gray-500 uppercase font-medium tracking-wide">
             {modelStatus === 'ready' ? 'Model Ready' : 'Loading Model...'}
           </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
              <Bot className="w-8 h-8 text-gray-300" />
            </div>
            <p className="text-sm">Upload documents to start a secure conversation.</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role !== 'user' && (
              <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-5 h-5 text-brand-600" />
              </div>
            )}
            
            <div className={`max-w-[80%] space-y-2`}>
              <div
                className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
                  msg.role === 'user'
                    ? 'bg-brand-600 text-white rounded-br-none'
                    : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'
                }`}
              >
                {msg.content}
              </div>
              
              {/* Citations / Sources */}
              {msg.sources && msg.sources.length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-3 space-y-2 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase">
                    <FileSearch className="w-3 h-3" />
                    Sources Used
                  </div>
                  <div className="grid gap-2">
                    {msg.sources.map((source, idx) => (
                      <div key={idx} className="text-xs bg-gray-50 p-2 rounded border border-gray-100">
                        <p className="font-medium text-gray-700 mb-1">Source {idx + 1} (Score: {(source.score * 100).toFixed(0)}%)</p>
                        <p className="text-gray-500 line-clamp-2 italic">"{source.text}"</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-gray-500" />
              </div>
            )}
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-4">
            <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
              <Bot className="w-5 h-5 text-brand-600" />
            </div>
            <div className="bg-white border border-gray-100 p-4 rounded-2xl rounded-bl-none shadow-sm flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 bg-white border-t border-gray-100">
        <form onSubmit={handleSubmit} className="relative flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your documents..."
            className="flex-1 bg-gray-50 text-gray-900 placeholder-gray-400 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
            disabled={isLoading || modelStatus !== 'ready'}
          />
          <Button 
            type="submit" 
            disabled={!input.trim() || isLoading || modelStatus !== 'ready'}
            className="rounded-xl w-12 h-11 p-0 flex items-center justify-center"
          >
            <Send className="w-5 h-5" />
          </Button>
        </form>
        <div className="text-center mt-2">
          <span className="text-[10px] text-gray-400">
            AI generated content may be inaccurate. Check important info.
          </span>
        </div>
      </div>
    </div>
  );
};