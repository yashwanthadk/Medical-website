import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Search,
  Trash2,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { api, type HistoryItem } from '../lib/api';

export function HistoryPage() {
  const navigate = useNavigate();

  const [items, setItems] = useState<HistoryItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | 'xray' | 'mri' | 'blood'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getHistory({ type: typeFilter, q: searchQuery });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load analysis history.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadHistory();
  };

  const handleDelete = async (reportId: string) => {
    setDeletingId(reportId);
    try {
      await api.deleteReport(reportId);
      setItems((prev) => prev.filter((item) => item.reportId !== reportId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete report.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleStartChat = async (reportId: string) => {
    try {
      const session = await api.createChatSession({ reportId });
      navigate(`/chat?session=${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open chat session.');
    }
  };

  const getReportHref = (item: HistoryItem) => {
    if (item.reportType === 'xray') return `/xray?reportId=${item.reportId}`;
    if (item.reportType === 'mri') return `/mri?reportId=${item.reportId}`;
    return `/blood-reports?reportId=${item.reportId}`;
  };

  return (
    <DashboardLayout
      title="Analysis History"
      subtitle="Access, search, discuss, or permanently delete your uploaded medical reports"
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {[
              { key: 'all', label: 'All Reports' },
              { key: 'xray', label: 'X-Ray' },
              { key: 'mri', label: 'MRI' },
              { key: 'blood', label: 'Blood Report' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTypeFilter(tab.key as any)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  typeFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search title or summary..."
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              Search
            </button>
          </form>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
            <span>Loading report history...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center space-y-3">
            <FileText className="mx-auto h-8 w-8 text-slate-400" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">No saved reports found</p>
              <p className="text-xs text-slate-500">
                Upload an X-ray, MRI scan, or blood test report to build your private medical
                explanation archive.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <Link
                to="/xray"
                className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800"
              >
                Analyze X-Ray
              </Link>
              <Link
                to="/mri"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Analyze MRI
              </Link>
              <Link
                to="/blood-reports"
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Analyze Blood Report
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <article
                key={item.reportId}
                className="rounded-2xl border border-slate-200 bg-white p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-semibold text-sky-800 uppercase">{item.reportType}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="capitalize">{item.status}</span>
                    {item.urgentFlag && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>Prompt Review Suggested</span>
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-base font-bold text-slate-900 truncate">
                    {item.title}
                  </h2>
                  {item.summaryPlain && (
                    <p className="text-xs leading-relaxed text-slate-600 line-clamp-2 max-w-3xl">
                      {item.summaryPlain}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <Link
                    to={getReportHref(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span>Open Report</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => void handleStartChat(item.reportId)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-100 whitespace-nowrap cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Ask AI</span>
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === item.reportId}
                    onClick={() => void handleDelete(item.reportId)}
                    aria-label={`Delete ${item.title}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 cursor-pointer"
                  >
                    {deletingId === item.reportId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    <span>Delete</span>
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
