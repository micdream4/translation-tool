
import React, { useEffect, useRef } from 'react';

interface LogConsoleProps {
  logs: string[];
}

const LogConsole: React.FC<LogConsoleProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-sm h-64 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between mb-2 border-b border-slate-800 pb-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500/50"></div>
          <div className="w-3 h-3 rounded-full bg-green-500/50"></div>
        </div>
        <span className="text-slate-500 text-xs">PYTHON_KERNEL_POCT_MODULE</span>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-800"
      >
        {logs.length === 0 && <p className="text-slate-600 italic">Waiting for process initiation...</p>}
        {logs.map((log, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-slate-500 whitespace-nowrap">[{new Date().toLocaleTimeString()}]</span>
            <span className={log.includes('Error') ? 'text-red-400' : log.includes('Success') ? 'text-green-400' : 'text-slate-300'}>
              {log}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogConsole;
