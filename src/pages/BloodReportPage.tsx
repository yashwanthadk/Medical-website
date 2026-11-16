import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  HelpCircle,
  Loader2,
  MessageSquare,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DashboardLayout } from '../components/DashboardLayout';
import { DropzoneUploader } from '../components/DropzoneUploader';
import { JobStatusBanner } from '../components/JobStatusBanner';
import {
  api,
  resolveApiUrl,
  type AnalysisDetail,
  type AnalysisJobStatus,
  type BloodResultRow,
} from '../lib/api';
import { downloadAnalysisSummary } from '../utils/downloadReport';

const STATUS_STYLE: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  Normal: {
    color: 'text-emerald-800',
    bg: 'bg-emerald-50 border-emerald-200',
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />,
  },
  High: {
    color: 'text-rose-800',
    bg: 'bg-rose-50 border-rose-200',
    icon: <ArrowUp className="h-3.5 w-3.5 text-rose-600" />,
  },
  Low: {
    color: 'text-amber-800',
    bg: 'bg-amber-50 border-amber-200',
    icon: <ArrowDown className="h-3.5 w-3.5 text-amber-600" />,
  },
  Unknown: {
    color: 'text-slate-700',
    bg: 'bg-slate-100 border-slate-200',
    icon: <HelpCircle className="h-3.5 w-3.5 text-slate-500" />,
  },
};

export function BloodReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reportIdParam = searchParams.get('reportId');

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [jobStatus, setJobStatus] = useState<AnalysisJobStatus | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisDetail | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(false);

  const [statusFilter, setStatusFilter] = useState<'All' | 'High' | 'Low' | 'Normal' | 'Unknown'>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [openingChat, setOpeningChat] = useState(false);

  useEffect(() => {
    if (!reportIdParam) return;
    let cancelled = false;
    setLoadingExisting(true);
    api
      .getReportDetail(reportIdParam)
      .then((detail) => {
        if (!cancelled && detail.reportType === 'blood') {
          setAnalysis(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : 'Unable to load blood report.');
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportIdParam]);

  const pollUntilDone = async (analysisId: string) => {
    for (let i = 0; i < 65; i++) {
      const st = await api.getAnalysisStatus(analysisId);
      setJobStatus(st);
      if (st.status === 'completed') {
        const detail = await api.getAnalysis(analysisId);
        setAnalysis(detail);
        return;
      }
      if (st.status === 'failed') {
        throw new Error(st.errorMessage || 'Blood report analysis failed.');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Analysis timed out while waiting for completion.');
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setErrorMessage(null);
    setDuplicateWarning(false);
    setAnalysis(null);
    setJobStatus(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const uploaded = await api.uploadFile(selectedFile, 'blood', (pct) => {
        setUploadProgress(pct);
      });
      setDuplicateWarning(uploaded.isDuplicate);
      setIsUploading(false);

      const started = await api.startAnalysis('blood', {
        fileId: uploaded.fileId,
        title: title.trim() || selectedFile.name,
        clinicalNotes: clinicalNotes.trim(),
      });

      if (started.status === 'completed') {
        const detail = await api.getAnalysis(started.analysisId);
        setAnalysis(detail);
      } else {
        await pollUntilDone(started.analysisId);
      }
    } catch (err) {
      setIsUploading(false);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to analyze blood report.');
    }
  };

  const handleOpenChat = async () => {
    if (!analysis) return;
    setOpeningChat(true);
    try {
      const session = await api.createChatSession({ reportId: analysis.reportId });
      navigate(`/chat?session=${session.id}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not start AI chat session.');
    } finally {
      setOpeningChat(false);
    }
  };

  const bloodResults: BloodResultRow[] = analysis?.bloodResults || [];

  const filteredResults = useMemo(() => {
    return bloodResults.filter((row) => {
      const matchesStatus = statusFilter === 'All' || row.status === statusFilter;
      const matchesQuery =
        !searchQuery.trim() ||
        row.test_name.toLowerCase().includes(searchQuery.trim().toLowerCase());
      return matchesStatus && matchesQuery;
    });
  }, [bloodResults, statusFilter, searchQuery]);

  const statusDistribution = useMemo(() => {
    const counts = { Normal: 0, High: 0, Low: 0, Unknown: 0 };
    for (const r of bloodResults) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return [
      { status: 'Normal', count: counts.Normal, fill: '#16a34a' },
      { status: 'High', count: counts.High, fill: '#dc2626' },
      { status: 'Low', count: counts.Low, fill: '#d97706' },
      { status: 'Unknown', count: counts.Unknown, fill: '#64748b' },
    ];
  }, [bloodResults]);

  // Normalized range index chart (0% = ref_min, 100% = ref_max)
  const normalizedChartData = useMemo(() => {
    return bloodResults
      .filter(
        (r) =>
          r.numeric_value !== null &&
          r.ref_min !== null &&
          r.ref_max !== null &&
          r.ref_max > r.ref_min
      )
      .slice(0, 12)
      .map((r) => {
        const span = r.ref_max! - r.ref_min!;
        const pct = Math.round(((r.numeric_value! - r.ref_min!) / span) * 100);
        return {
          name: r.test_name.length > 18 ? `${r.test_name.slice(0, 16)}…` : r.test_name,
          fullName: r.test_name,
          positionPct: Math.max(-40, Math.min(160, pct)),
          measured: `${r.measured_value} ${r.unit}`,
          range: r.reference_range,
          status: r.status,
        };
      });
  }, [bloodResults]);

  return (
    <DashboardLayout
      title="Blood Report Explainer"
      subtitle="Upload PDF or image lab reports for biomarker extraction, range charts, and simple explanations"
    >
      <div className="space-y-6">
        {!analysis && !loadingExisting && (
          <form
            onSubmit={handleAnalyze}
            className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Upload Blood Test Report
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Digital PDFs use text extraction; scanned PDFs and photos use multimodal vision OCR.
                </p>
              </div>
              <Activity className="h-5 w-5 text-sky-700 shrink-0" />
            </div>

            <DropzoneUploader
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              acceptedExtensionsLabel="PDF, JPG, JPEG, PNG"
              selectedFile={selectedFile}
              onFileSelected={setSelectedFile}
              uploadProgress={uploadProgress}
              isUploading={isUploading}
              duplicateWarning={duplicateWarning}
              errorMessage={errorMessage}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="blood-title" className="block text-xs font-semibold text-slate-700">
                  Report Title (Optional)
                </label>
                <input
                  id="blood-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Complete Blood Count & Lipid Panel"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="blood-notes" className="block text-xs font-semibold text-slate-700">
                  Fasting / Clinical Context (Optional)
                </label>
                <input
                  id="blood-notes"
                  type="text"
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="e.g., Fasting 10 hours, annual physical"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!selectedFile || isUploading || (jobStatus !== null && jobStatus.status !== 'failed')}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-sky-700 px-6 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <span>Extract &amp; Explain Blood Report</span>
              </button>
            </div>
          </form>
        )}

        {jobStatus && !analysis && <JobStatusBanner job={jobStatus} />}

        {loadingExisting && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 flex items-center justify-center gap-2.5 text-sm text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
            <span>Loading blood report analysis...</span>
          </div>
        )}

        {analysis && (
          <div className="space-y-6">
            {/* Header Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-slate-500">
                  Blood Panel Explanation · {new Date(analysis.createdAt).toLocaleString()} ·{' '}
                  <span className="tabular-nums">{bloodResults.length} markers extracted</span>
                </p>
                <h2 className="font-display text-xl font-bold text-slate-950">{analysis.title}</h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setAnalysis(null);
                    setSelectedFile(null);
                    setJobStatus(null);
                    setErrorMessage(null);
                    navigate('/blood-reports', { replace: true });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>New Report</span>
                </button>
                <button
                  type="button"
                  onClick={() => downloadAnalysisSummary(analysis)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Summary</span>
                </button>
                <button
                  type="button"
                  disabled={openingChat}
                  onClick={handleOpenChat}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-800 cursor-pointer"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Ask AI Chat</span>
                </button>
              </div>
            </div>

            {analysis.urgentFlag && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-950">
                <AlertTriangle className="h-5 w-5 text-rose-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Urgent Clinical Review Flagged</p>
                  <p className="text-xs leading-relaxed">
                    {analysis.urgentReason ||
                      'One or more extracted laboratory values appear markedly outside reference bounds and warrant prompt evaluation by a physician.'}
                  </p>
                </div>
              </div>
            )}

            {/* Overall Summary + Document Preview */}
            <div className="grid gap-6 lg:grid-cols-12 items-start">
              <section className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
                <p className="text-xs font-semibold text-sky-800">Overall Easy-to-Understand Summary</p>
                <p className="text-sm leading-relaxed text-slate-800">{analysis.summaryPlain}</p>
                {analysis.limitations && (
                  <p className="text-xs text-slate-500 border-t border-slate-200 pt-3">
                    <strong>Extraction Notes &amp; Limitations:</strong> {analysis.limitations}
                  </p>
                )}
              </section>

              <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 truncate">
                    {analysis.file?.originalFilename || 'Uploaded Lab Document'}
                  </span>
                  {analysis.file?.signedPreviewUrl && (
                    <a
                      href={resolveApiUrl(analysis.file.signedPreviewUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-sky-700 hover:text-sky-900 shrink-0"
                    >
                      <span>Open</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                {analysis.file?.signedPreviewUrl ? (
                  analysis.file.mimeType === 'application/pdf' ? (
                    <iframe
                      title={analysis.title}
                      src={resolveApiUrl(analysis.file.signedPreviewUrl)}
                      className="h-56 w-full rounded-lg border border-slate-200 bg-slate-50"
                    />
                  ) : (
                    <img
                      src={resolveApiUrl(analysis.file.signedPreviewUrl)}
                      alt={analysis.title}
                      className="h-56 w-full rounded-lg border border-slate-200 object-contain bg-slate-50"
                    />
                  )
                ) : (
                  <p className="text-xs text-slate-400 py-10 text-center">Preview unavailable</p>
                )}
              </section>
            </div>

            {/* Interactive Charts */}
            {bloodResults.length > 0 && (
              <div className="grid gap-6 lg:grid-cols-12">
                <section className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Test Result Status Breakdown
                  </h3>
                  <div className="h-60 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={statusDistribution}
                        margin={{ top: 10, right: 12, left: -18, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="status" tick={{ fontSize: 12, fill: '#475569' }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} />
                        <Tooltip />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                          {statusDistribution.map((entry) => (
                            <Cell key={entry.status} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                <section className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Position Within Printed Reference Range (0% = Low Bound, 100% = High Bound)
                    </h3>
                  </div>
                  {normalizedChartData.length === 0 ? (
                    <div className="h-60 flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl">
                      No numeric tests with both lower and upper printed bounds to plot.
                    </div>
                  ) : (
                    <div className="h-60 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={normalizedChartData}
                          layout="vertical"
                          margin={{ top: 5, right: 24, left: 10, bottom: 5 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis
                            type="number"
                            domain={[-25, 140]}
                            tickFormatter={(v) => `${v}%`}
                            tick={{ fontSize: 11, fill: '#475569' }}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={120}
                            tick={{ fontSize: 11, fill: '#334155' }}
                          />
                          <Tooltip
                            formatter={(val: any) => [`${val}% of reference span`, 'Position']}
                          />
                          <ReferenceLine x={0} stroke="#94a3b8" strokeDasharray="3 3" />
                          <ReferenceLine x={100} stroke="#94a3b8" strokeDasharray="3 3" />
                          <Bar dataKey="positionPct" radius={[0, 4, 4, 0]}>
                            {normalizedChartData.map((d) => (
                              <Cell
                                key={d.fullName}
                                fill={
                                  d.status === 'High'
                                    ? '#dc2626'
                                    : d.status === 'Low'
                                      ? '#d97706'
                                      : '#0284c7'
                                }
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* Biomarkers Table */}
            <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 p-5">
                <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['All', 'High', 'Low', 'Normal', 'Unknown'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setStatusFilter(tab)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                        statusFilter === tab
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-64">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter biomarker name..."
                    className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-xs text-slate-900 focus:border-sky-600 focus:outline-none"
                  />
                </div>
              </div>

              {filteredResults.length === 0 ? (
                <div className="p-10 text-center text-sm text-slate-500">
                  No matching blood test markers found.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Test Name</th>
                        <th className="py-3 px-4 text-right">Measured Value</th>
                        <th className="py-3 px-4">Unit</th>
                        <th className="py-3 px-4">Printed Reference Range</th>
                        <th className="py-3 px-4">Indicator</th>
                        <th className="py-3 px-4">Confidence</th>
                        <th className="py-3 px-4 text-right">Explanation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm">
                      {filteredResults.map((row) => {
                        const isExpanded = expandedRow === row.id;
                        const st = STATUS_STYLE[row.status] || STATUS_STYLE.Unknown;
                        return (
                          <React.Fragment key={row.id}>
                            <tr
                              onClick={() => setExpandedRow(isExpanded ? null : row.id)}
                              className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                            >
                              <td className="py-3 px-4 font-medium text-slate-900">
                                {row.test_name}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-semibold text-slate-900 tabular-nums">
                                {row.measured_value}
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-600">
                                {row.unit || '—'}
                              </td>
                              <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums">
                                {row.reference_range || 'Unknown'}
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${st.bg} ${st.color}`}
                                >
                                  {st.icon}
                                  <span>{row.status}</span>
                                </span>
                              </td>
                              <td className="py-3 px-4 text-xs text-slate-500">
                                {row.extraction_confidence}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-700"
                                >
                                  <span>{isExpanded ? 'Hide' : 'Explain'}</span>
                                  {isExpanded ? (
                                    <ChevronUp className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-sky-50/40">
                                <td colSpan={7} className="px-4 py-3 text-xs leading-relaxed text-slate-700">
                                  <strong className="text-slate-900">{row.test_name}:</strong>{' '}
                                  {row.simple_explanation}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div className="rounded-xl border border-slate-200 bg-slate-100/70 p-4 text-xs text-slate-600">
              <strong>Medical Safety Disclaimer:</strong>{' '}
              {analysis.disclaimer ||
                'Blood test explanations are educational only. Always interpret lab values alongside your symptoms and physician guidance.'}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
