
import React, { useEffect, useRef } from 'react';

interface LogConsoleProps {
  logs: string[];
  theme?: 'light' | 'dark';
}

const LogConsole: React.FC<LogConsoleProps> = ({ logs, theme = 'dark' }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className={`rounded-2xl border p-4 font-mono text-sm h-64 flex flex-col ${
      isLight
        ? 'bg-white/92 border-slate-200/80 shadow-[0_16px_40px_rgba(15,23,42,0.08)]'
        : 'bg-slate-950/70 border-white/[0.07] shadow-2xl'
    }`}>
      <div className={`flex items-center justify-between mb-2 border-b pb-2 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/75"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/75"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/75"></div>
        </div>
        <span className={`text-xs ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>PYTHON_KERNEL_POCT_MODULE</span>
      </div>
      <div 
        ref={scrollRef}
        className={`flex-1 overflow-y-auto space-y-1 scrollbar-thin ${isLight ? 'scrollbar-thumb-slate-200' : 'scrollbar-thumb-slate-800'}`}
      >
        {logs.length === 0 && <p className={`italic ${isLight ? 'text-slate-400' : 'text-slate-600'}`}>Waiting for process initiation...</p>}
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className={`whitespace-nowrap ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>[{new Date().toLocaleTimeString()}]</span>
            <span className={
              log.includes('Error')
                ? isLight ? 'text-rose-600' : 'text-red-400'
                : log.includes('Success')
                  ? isLight ? 'text-emerald-600' : 'text-green-400'
                  : isLight ? 'text-slate-700' : 'text-slate-300'
            }>
              {log}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogConsole;
