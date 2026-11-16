import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Brain,
  FileText,
  Loader2,
  MessageSquare,
  ScanLine,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DashboardLayout } from '../components/DashboardLayout';
import { api, type DashboardSummary } from '../lib/api';

const STATUS_COLORS: Record<string, string> = {
  Normal: '#16a34a',
  High: '#dc2626',
  Low: '#d97706',
  Unknown: '#64748b',
};

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDashboardSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const getReportHref = (reportType: string, reportId: string) => {
    if (reportType === 'xray') return `/xray?reportId=${reportId}`;
    if (reportType === 'mri') return `/mri?reportId=${reportId}`;
    return `/blood-reports?reportId=${reportId}`;
  };

  return (
    <DashboardLayout
      title="Medical Report Dashboard"
      subtitle="Your unified workspace for X-ray, MRI, blood report explanations, and medical Q&A"
    >
      <div className="space-y-8">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        )}

        {/* Metrics Strip */}
        <section aria-label="Report Summary Metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Total Uploaded Reports', value: summary?.metrics.totalReports ?? 0 },
            { label: 'X-Ray Analyses', value: summary?.metrics.xrayCount ?? 0 },
            { label: 'MRI Analyses', value: summary?.metrics.mriCount ?? 0 },
            { label: 'Blood Report Analyses', value: summary?.metrics.bloodCount ?? 0 },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-xl border border-slate-200 bg-white p-5 space-y-1"
            >
              <p className="text-xs font-medium text-slate-500">{m.label}</p>
              <p className="font-display text-3xl font-bold text-slate-950 tabular-nums">
                {loading ? '—' : m.value}
              </p>
            </div>
          ))}
        </section>

        {/* Quick Upload Workflows */}
        <section className="space-y-3">
          <h2 className="font-display text-base font-bold text-slate-900">
            Start a New Analysis or Conversation
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              to="/xray"
              className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-sky-500 transition-colors space-y-3"
            >
              <ScanLine className="h-5 w-5 text-sky-700" />
              <div>
                <p className="font-display text-sm font-bold text-slate-900 group-hover:text-sky-800">
                  Upload X-Ray
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Chest, bone, or joint radiographs (JPG, PNG)
                </p>
              </div>
            </Link>

            <Link
              to="/mri"
              className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-sky-500 transition-colors space-y-3"
            >
              <Brain className="h-5 w-5 text-sky-700" />
              <div>
                <p className="font-display text-sm font-bold text-slate-900 group-hover:text-sky-800">
                  Upload MRI Scan
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Brain, spine, or knee scan images (JPG, PNG)
                </p>
              </div>
            </Link>

            <Link
              to="/blood-reports"
              className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-sky-500 transition-colors space-y-3"
            >
              <Activity className="h-5 w-5 text-sky-700" />
              <div>
                <p className="font-display text-sm font-bold text-slate-900 group-hover:text-sky-800">
                  Upload Blood Report
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Lab PDFs or photos with OCR &amp; range charts
                </p>
              </div>
            </Link>

            <Link
              to="/chat"
              className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-sky-500 transition-colors space-y-3"
            >
              <MessageSquare className="h-5 w-5 text-sky-700" />
              <div>
                <p className="font-display text-sm font-bold text-slate-900 group-hover:text-sky-800">
                  AI Medical Chat
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Ask follow-up questions about your reports
                </p>
              </div>
            </Link>
          </div>
        </section>

        {/* Recent Reports + Health Overview */}
        <div className="grid gap-6 lg:grid-cols-12">
          <section className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="font-display text-base font-bold text-slate-900">Recent Analyses</h2>
              <Link
                to="/history"
                className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 hover:text-sky-900 whitespace-nowrap"
              >
                <span>View All History</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {loading ? (
              <div className="py-10 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-sky-700" />
                <span>Loading your reports...</span>
              </div>
            ) : !summary || summary.recentReports.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center space-y-3">
                <FileText className="mx-auto h-7 w-7 text-slate-400" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-900">No reports analyzed yet</p>
                  <p className="text-xs text-slate-500">
                    Upload your first X-ray, MRI scan, or blood test report to see plain-language
                    summaries here.
                  </p>
                </div>
                <div className="pt-1">
                  <Link
                    to="/blood-reports"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800"
                  >
                    <span>Upload First Report</span>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-200">
                {summary.recentReports.map((item) => (
                  <Link
                    key={item.reportId}
                    to={getReportHref(item.reportType, item.reportId)}
                    className="block py-3.5 first:pt-1 last:pb-1 hover:bg-slate-50/70 -mx-2 px-2 rounded-lg transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-sky-800 uppercase">
                            {item.reportType}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{item.status}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 truncate">{item.title}</p>
                        {item.summaryPlain && (
                          <p className="text-xs text-slate-600 line-clamp-2">{item.summaryPlain}</p>
                        )}
                      </div>
                      {item.urgentFlag && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 shrink-0">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>Review</span>
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Blood Biomarker Indicator Breakdown
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Aggregated counts across all extracted blood test panels
              </p>
            </div>

            {loading ? (
              <div className="h-56 flex items-center justify-center text-xs text-slate-500">
                Loading indicator summary...
              </div>
            ) : !summary || summary.bloodDistribution.length === 0 ? (
              <div className="h-56 flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 p-6 text-center space-y-2">
                <Activity className="h-6 w-6 text-slate-400" />
                <p className="text-xs text-slate-500">
                  Upload a blood report PDF or image to visualize Normal, High, Low, and Unknown
                  biomarker counts here.
                </p>
              </div>
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={summary.bloodDistribution}
                    margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="status" tick={{ fontSize: 12, fill: '#475569' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} />
                    <Tooltip />
                    <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                      {summary.bloodDistribution.map((entry) => (
                        <Cell
                          key={entry.status}
                          fill={STATUS_COLORS[entry.status] || '#0284c7'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="border-t border-slate-200 pt-4 text-xs text-slate-600 leading-relaxed">
              <strong className="text-slate-800">Health Information Reminder:</strong> Reference
              ranges depend on laboratory methodology, age, and clinical history. Always review
              results with your healthcare provider.
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
