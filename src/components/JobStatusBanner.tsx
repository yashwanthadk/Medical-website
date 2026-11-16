import { AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react';
import type { AnalysisJobStatus } from '../lib/api';

const STEPS: Array<{ key: AnalysisJobStatus['status']; label: string }> = [
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'queued', label: 'Queued' },
  { key: 'processing', label: 'Analyzing with AI' },
  { key: 'completed', label: 'Completed' },
];

export function JobStatusBanner({ job }: { job: AnalysisJobStatus }) {
  const activeIdx = STEPS.findIndex((s) => s.key === job.status);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {job.status === 'failed' ? (
            <AlertTriangle className="h-5 w-5 text-rose-600" />
          ) : job.status === 'completed' ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          ) : (
            <Loader2 className="h-5 w-5 text-sky-700 animate-spin" />
          )}
          <span className="text-sm font-semibold text-slate-900">
            {job.status === 'failed'
              ? 'Analysis could not be completed'
              : job.status === 'completed'
                ? 'Analysis ready'
                : 'Processing your medical upload asynchronously'}
          </span>
        </div>

        <span className="text-xs text-slate-500 font-mono tabular-nums">
          Attempts: {job.attempts || 1}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {STEPS.map((step, idx) => {
          const done = job.status === 'completed' || (activeIdx >= 0 && idx < activeIdx);
          const current = job.status !== 'failed' && activeIdx === idx && job.status !== 'completed';
          return (
            <div key={step.key} className="space-y-1.5">
              <div
                className={`h-1.5 rounded-full transition-colors ${
                  job.status === 'failed' && idx >= 2
                    ? 'bg-rose-200'
                    : done
                      ? 'bg-emerald-600'
                      : current
                        ? 'bg-sky-600'
                        : 'bg-slate-200'
                }`}
              />
              <div className="flex items-center gap-1 text-xs font-medium text-slate-600">
                {!done && !current && <Clock className="h-3 w-3 text-slate-400 shrink-0" />}
                <span className={done || current ? 'text-slate-900' : 'text-slate-500'}>
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {job.status === 'failed' && job.errorMessage && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900">
          {job.errorMessage}
        </div>
      )}
    </div>
  );
}
