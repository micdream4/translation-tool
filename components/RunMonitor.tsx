import React, { useEffect, useMemo, useState } from 'react';
import type { BatchRun } from '../types';
import { useI18n } from '../hooks/useI18n';

export const SLOW_BATCH_WARNING_MS = 45_000;
const VISIBLE_BATCH_LIMIT = 8;

interface RunMonitorProps {
  isLight: boolean;
  statusLabel: string;
  progress: number;
  modelLabel: string;
  batchRuns: BatchRun[];
  showPauseResume: boolean;
  isTranslating: boolean;
  pauseResumeDisabled: boolean;
  onPauseResume: () => void;
  panelClass: string;
  metricCardClass: string;
  mutedTextClass: string;
  neutralButtonClass: string;
  disabledButtonClass: string;
}

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const RunMonitor: React.FC<RunMonitorProps> = ({
  isLight,
  statusLabel,
  progress,
  modelLabel,
  batchRuns,
  showPauseResume,
  isTranslating,
  pauseResumeDisabled,
  onPauseResume,
  panelClass,
  metricCardClass,
  mutedTextClass,
  neutralButtonClass,
  disabledButtonClass
}) => {
  const { t } = useI18n();
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = batchRuns.find((run) => run.status === 'running');

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running?.id]);

  const waitedMs = running ? Math.max(0, now - running.startedAt) : 0;
  const isSlow = Boolean(running) && waitedMs >= SLOW_BATCH_WARNING_MS;
  const lastUsedModel = [...batchRuns].reverse().find((run) => run.model)?.model;
  const latestTotal = batchRuns.length > 0 ? batchRuns[batchRuns.length - 1].totalBatches : 0;
  const latestNum = batchRuns.length > 0 ? batchRuns[batchRuns.length - 1].batchNum : 0;
  const problemCount = batchRuns.filter((run) => run.status === 'failed' || run.status === 'switched').length;

  const visibleRuns = useMemo(() => {
    const filtered = issuesOnly
      ? batchRuns.filter((run) => run.status === 'failed' || run.status === 'switched' || run.status === 'running')
      : batchRuns;
    return filtered.slice(-VISIBLE_BATCH_LIMIT).reverse();
  }, [batchRuns, issuesOnly]);

  const statusChip = (run: BatchRun) => {
    const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold whitespace-nowrap';
    switch (run.status) {
      case 'running':
        return `${base} ${'bg-primary-soft text-primary-ink'}`;
      case 'failed':
        return `${base} ${'bg-danger-soft text-danger'}`;
      case 'switched':
        return `${base} ${'bg-warning-soft text-warning'}`;
      default:
        return `${base} ${'bg-success-soft text-success'}`;
    }
  };

  return (
    <section className={`${panelClass} space-y-4`} aria-label={t('monitor.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-title font-semibold">{t('monitor.title')}</h2>
          <span className={`rounded-full px-3 py-0.5 text-caption font-semibold ${
            'bg-subtle text-ink-soft'
          }`}>
            {statusLabel}
          </span>
          <span className={`text-caption ${mutedTextClass}`}>{t('monitor.autosave')}</span>
        </div>
        {showPauseResume && (
          <button
            type="button"
            onClick={onPauseResume}
            disabled={pauseResumeDisabled}
            className={`inline-flex items-center justify-center rounded-control px-4 h-9 text-body font-semibold transition-all ${
              pauseResumeDisabled ? disabledButtonClass : neutralButtonClass
            }`}
          >
            {isTranslating ? t('monitor.pause') : t('monitor.resume')}
          </button>
        )}
      </div>

      <div
        className={`h-2 overflow-hidden rounded-full ${'bg-subtle'}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>

      <div className="grid grid-cols-2 gap-3 text-body lg:grid-cols-3">
        <div className={metricCardClass}>
          <p className={`text-caption ${mutedTextClass}`}>{t('monitor.progress')}</p>
          <p className="mt-1 text-title font-semibold tabular-nums">{progress}%</p>
        </div>
        <div className={metricCardClass}>
          <p className={`text-caption ${mutedTextClass}`}>{t('monitor.batch')}</p>
          <p className="mt-1 text-title font-semibold tabular-nums">
            {latestTotal > 0 ? `${latestNum} / ${latestTotal}` : '-'}
          </p>
        </div>
        <div className={`${metricCardClass} col-span-2 lg:col-span-1`}>
          <p className={`text-caption ${mutedTextClass}`}>{t('monitor.model')}</p>
          <p className="mt-1 truncate text-title font-semibold" title={lastUsedModel || modelLabel}>{lastUsedModel || modelLabel}</p>
        </div>
      </div>

      {isSlow && running && (
        <div
          role="status"
          className={`rounded-control border px-4 py-3 text-body ${
            'border-warning-border bg-warning-soft text-warning'
          }`}
        >
          {t('monitor.slow', { batch: running.batchNum, seconds: Math.round(waitedMs / 1000) })}
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span />
          {problemCount > 0 && (
            <button
              type="button"
              onClick={() => setIssuesOnly((value) => !value)}
              aria-pressed={issuesOnly}
              className={`rounded-full border px-3 py-1 text-caption font-semibold ${
                issuesOnly
                  ? 'border-primary-border bg-primary-soft text-primary-ink'
                  : 'border-line text-ink-soft'
              }`}
            >
              {t('monitor.issuesOnly')} {problemCount}
            </button>
          )}
        </div>

        {visibleRuns.length === 0 ? (
          <p className={`rounded-control border border-dashed px-4 py-6 text-center text-body ${
            'border-line text-muted'
          }`}>
            {t('monitor.empty')}
          </p>
        ) : (
          <ul className={`divide-y ${'divide-line'}`}>
            {visibleRuns.map((run) => {
              const elapsed = run.status === 'running' ? waitedMs : run.elapsedMs || 0;
              return (
                <li key={run.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-mono text-caption tabular-nums">#{run.batchNum}</span>
                  <div className="min-w-0">
                    <p className="truncate text-body" title={run.model || undefined}>
                      {t('monitor.units', {
                        count: run.items,
                        unit: run.unit === 'rows' ? t('common.rows') : t('common.segments')
                      })}
                      {run.model ? ` · ${run.model}` : ''}
                    </p>
                    <p className={`truncate font-mono text-caption tabular-nums ${mutedTextClass}`} title={run.note || undefined}>
                      {formatSeconds(elapsed)}
                      {run.note ? ` · ${run.note}` : ''}
                    </p>
                  </div>
                  <span className={statusChip(run)}>{t(`monitor.state.${run.status}`)}</span>
                  {run.status === 'failed' && (
                    <p className={`col-start-2 col-span-2 text-caption ${'text-danger'}`}>
                      {t('monitor.skippedHint')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
};

export default RunMonitor;
