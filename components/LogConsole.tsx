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
    if (/error|失败|出错/i.test(message)) return 'text-danger';
    if (/warning|警告|跳过|超时|timeout/i.test(message)) return 'text-warning';
    if (/success|完成|成功/i.test(message)) return 'text-success';
    return 'text-ink-soft';
  };

  return (
    <div
      className={`flex h-72 flex-col rounded-panel border p-4 font-mono text-caption ${
        'border-line bg-surface'
      }`}
    >
      {onClear && (
        <div className={`mb-2 flex justify-end border-b pb-2 ${'border-line'}`}>
          <button
            type="button"
            onClick={onClear}
            className={`text-caption ${'text-primary-ink hover:text-primary-ink'}`}
          >
            {t('logs.clear')}
          </button>
        </div>
      )}
      <div ref={scrollRef} className="flex-1 space-y-1 overflow-y-auto">
        {logs.length === 0 && (
          <p className={`italic ${'text-muted'}`}>{t('logs.waiting')}</p>
        )}
        {logs.map((log, index) => (
          <div key={index} className="flex gap-2">
            <span className={`whitespace-nowrap tabular-nums ${'text-muted'}`}>
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
