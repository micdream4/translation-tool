import React, { useEffect, useRef } from 'react';
import type { LogEntry } from '../types';
import { useI18n } from '../hooks/useI18n';
import { localizeLogMessage } from '../utils/logDisplay';

interface LogConsoleProps {
  logs: LogEntry[];
  theme?: 'light' | 'dark';
  onClear?: () => void;
}

const formatTime = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour12: false });

const LogConsole: React.FC<LogConsoleProps> = ({ logs, theme = 'dark', onClear }) => {
  const { t, lang } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isLight = theme === 'light';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const toneFor = (message: string) => {
    if (/error|失败|出错/i.test(message)) return isLight ? 'text-rose-600' : 'text-rose-300';
    if (/warning|警告|跳过|超时|timeout/i.test(message)) return isLight ? 'text-amber-700' : 'text-amber-300';
    if (/success|完成|成功/i.test(message)) return isLight ? 'text-emerald-700' : 'text-emerald-300';
    return isLight ? 'text-slate-700' : 'text-slate-300';
  };

  return (
    <div
      className={`flex h-72 flex-col rounded-2xl border p-4 font-mono text-xs ${
        isLight ? 'border-slate-200/80 bg-white' : 'border-white/[0.07] bg-slate-950/70'
      }`}
    >
      {onClear && (
        <div className={`mb-2 flex justify-end border-b pb-2 ${isLight ? 'border-slate-200' : 'border-slate-800'}`}>
          <button
            type="button"
            onClick={onClear}
            className={`text-xs ${isLight ? 'text-indigo-600 hover:text-indigo-800' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t('logs.clear')}
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto">
        {logs.length === 0 && (
          <p className={`italic ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>{t('logs.waiting')}</p>
        )}
        {logs.map((log, index) => (
          <div key={index} className="flex gap-2">
            <span className={`whitespace-nowrap tabular-nums ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
              {formatTime(log.time)}
            </span>
            <span className={`min-w-0 break-words ${toneFor(log.message)}`}>{localizeLogMessage(log.message, lang)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default LogConsole;
