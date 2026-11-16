import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Contrast,
  Download,
  Loader2,
  MessageSquare,
  RotateCcw,
  ScanLine,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { DashboardLayout } from '../components/DashboardLayout';
import { DropzoneUploader } from '../components/DropzoneUploader';
import { JobStatusBanner } from '../components/JobStatusBanner';
import { useAuth } from '../context/AuthContext';
import { api, type AnalysisDetail, type AnalysisJobStatus } from '../lib/api';
import { downloadAnalysisSummary } from '../utils/downloadReport';

export function XRayAnalysisPage() {
  const { token } = useAuth();
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

  // Viewer controls
  const [zoom, setZoom] = useState(1);
  const [invertRadiograph, setInvertRadiograph] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

  useEffect(() => {
    if (!reportIdParam || !token) return;
    let cancelled = false;
    setLoadingExisting(true);
    setErrorMessage(null);
    api
      .getReportDetail(reportIdParam, token)
      .then((detail) => {
        if (!cancelled && detail.reportType === 'xray') {
          setAnalysis(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) setErrorMessage(err instanceof Error ? err.message : 'Unable to load X-ray report.');
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportIdParam, token]);

  const pollUntilDone = async (analysisId: string) => {
    if (!token) return;
    for (let i = 0; i < 60; i++) {
      const st = await api.getAnalysisStatus(analysisId, token);
      setJobStatus(st);
      if (st.status === 'completed') {
        const detail = await api.getAnalysis(analysisId, token);
        setAnalysis(detail);
        return;
      }
      if (st.status === 'failed') {
        throw new Error(st.errorMessage || 'X-ray analysis failed.');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error('Analysis timed out while waiting for completion.');
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !token) return;

    setErrorMessage(null);
    setDuplicateWarning(false);
    setAnalysis(null);
    setJobStatus(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const uploaded = await api.uploadFile(selectedFile, 'xray', token, (pct) => {
        setUploadProgress(pct);
      });
      setDuplicateWarning(uploaded.isDuplicate);
      setIsUploading(false);

      const started = await api.startAnalysis(
        'xray',
        {
          fileId: uploaded.fileId,
          title: title.trim() || selectedFile.name,
          clinicalNotes: clinicalNotes.trim(),
        },
        token
      );

      await pollUntilDone(started.analysisId);
    } catch (err) {
      setIsUploading(false);
      setErrorMessage(err instanceof Error ? err.message : 'Failed to analyze X-ray image.');
    }
  };

  const handleOpenChat = async () => {
    if (!analysis || !token) return;
    setOpeningChat(true);
    try {
      const session = await api.createChatSession({ reportId: analysis.reportId }, token);
      navigate(`/chat?session=${session.id}`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not start AI chat session.');
    } finally {
      setOpeningChat(false);
    }
  };

  const structured = analysis?.structured || {};

  return (
    <DashboardLayout
      title="X-Ray Image Explainer"
      subtitle="Upload chest, bone, or joint X-rays (JPG, PNG) for structured visual observations"
    >
      <div className="space-y-6">
        {/* Upload Form */}
        {!analysis && !loadingExisting && (
          <form
            onSubmit={handleAnalyze}
            className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Upload X-Ray Radiograph
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Educational AI visual walkthrough — never a medical diagnosis.
                </p>
              </div>
              <ScanLine className="h-5 w-5 text-sky-700 shrink-0" />
            </div>

            <DropzoneUploader
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              acceptedExtensionsLabel="JPG, JPEG, PNG"
              selectedFile={selectedFile}
              onFileSelected={setSelectedFile}
              uploadProgress={uploadProgress}
              isUploading={isUploading}
              duplicateWarning={duplicateWarning}
              errorMessage={errorMessage}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="xray-title" className="block text-xs font-semibold text-slate-700">
                  Study Title (Optional)
                </label>
                <input
                  id="xray-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Frontal Chest X-Ray"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600/20"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="xray-notes" className="block text-xs font-semibold text-slate-700">
                  Body Region or Symptoms Context (Optional)
                </label>
                <input
                  id="xray-notes"
                  type="text"
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="e.g., Right wrist after fall, chest check"
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
                <span>Analyze X-Ray Image</span>
              </button>
            </div>
          </form>
        )}

        {jobStatus && !analysis && <JobStatusBanner job={jobStatus} />}

        {loadingExisting && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 flex items-center justify-center gap-2.5 text-sm text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin text-sky-700" />
            <span>Loading X-ray analysis...</span>
          </div>
        )}

        {/* Result View */}
        {analysis && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-slate-500">
                  X-Ray Explanation · {new Date(analysis.createdAt).toLocaleString()}
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
                    navigate('/xray', { replace: true });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>New X-Ray</span>
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
                  <p className="font-semibold">Prompt Medical Review Recommended</p>
                  <p className="text-xs leading-relaxed">
                    {analysis.urgentReason ||
                      'Visible patterns in this image warrant prompt review by a qualified physician or radiologist.'}
                  </p>
                </div>
              </div>
            )}

            {structured.imageSuitability === 'unsuitable_or_unclear' && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold">Image Quality or Type Limitation</p>
                  <p className="text-xs leading-relaxed">
                    {analysis.summaryPlain ||
                      'This uploaded image could not be reliably assessed as a clear medical X-ray radiograph.'}
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-6 lg:grid-cols-12 items-start">
              {/* Radiograph Viewer */}
              <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-slate-950 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 text-xs text-slate-300">
                  <span className="truncate">
                    {structured.identifiableViewOrRegion || 'Uploaded Radiograph'}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                      aria-label="Zoom out"
                      className="rounded p-1 hover:bg-slate-800"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <span className="font-mono tabular-nums text-[11px]">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))}
                      aria-label="Zoom in"
                      className="rounded p-1 hover:bg-slate-800"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvertRadiograph((v) => !v)}
                      title="Invert contrast"
                      aria-label="Invert radiograph contrast"
                      className={`rounded p-1 ${invertRadiograph ? 'bg-sky-700 text-white' : 'hover:bg-slate-800'}`}
                    >
                      <Contrast className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="overflow-auto max-h-[520px] flex items-center justify-center p-4 bg-black">
                  {analysis.file?.signedPreviewUrl ? (
                    <img
                      src={analysis.file.signedPreviewUrl}
                      alt={analysis.title}
                      style={{
                        transform: `scale(${zoom})`,
                        filter: invertRadiograph ? 'invert(1)' : 'none',
                      }}
                      className="max-h-[460px] w-auto object-contain transition-transform duration-150"
                    />
                  ) : (
                    <p className="text-xs text-slate-400 py-20">Preview unavailable</p>
                  )}
                </div>
              </div>

              {/* Structured Observations */}
              <div className="lg:col-span-7 space-y-5">
                <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-2">
                  <p className="text-xs font-semibold text-sky-800">Plain-Language Explanation</p>
                  <p className="text-sm leading-relaxed text-slate-800">{analysis.summaryPlain}</p>
                  {structured.uncertaintyNote && (
                    <p className="text-xs text-slate-500 pt-1">{structured.uncertaintyNote}</p>
                  )}
                </section>

                {Array.isArray(structured.visibleObservations) &&
                  structured.visibleObservations.length > 0 && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
                      <h3 className="font-display text-base font-bold text-slate-900">
                        Visible Observations
                      </h3>
                      <div className="divide-y divide-slate-200">
                        {structured.visibleObservations.map((obs: any, idx: number) => (
                          <div key={idx} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-semibold text-slate-900">
                                {obs.region}
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  obs.attentionLevel === 'urgent_review'
                                    ? 'text-rose-700'
                                    : obs.attentionLevel === 'review_recommended'
                                      ? 'text-amber-700'
                                      : 'text-emerald-700'
                                }`}
                              >
                                {obs.attentionLevel === 'urgent_review'
                                  ? 'Urgent Review'
                                  : obs.attentionLevel === 'review_recommended'
                                    ? 'Clinical Review Suggested'
                                    : 'Routine Observation'}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-700">{obs.observation}</p>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {obs.plainExplanation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Areas for Professional Review
                    </h3>
                    <ul className="space-y-1.5 text-xs text-slate-600">
                      {(structured.areasRequiringProfessionalReview || []).map(
                        (item: string, i: number) => (
                          <li key={i}>• {item}</li>
                        )
                      )}
                    </ul>
                  </section>

                  <section className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Cannot Be Assessed Reliably
                    </h3>
                    <ul className="space-y-1.5 text-xs text-slate-600">
                      {(structured.cannotBeAssessedReliably || []).map(
                        (item: string, i: number) => (
                          <li key={i}>• {item}</li>
                        )
                      )}
                    </ul>
                  </section>
                </div>

                <section className="rounded-2xl border border-slate-200 bg-slate-100/70 p-5 space-y-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-800">Technical Limitations &amp; Disclaimer</p>
                  {Array.isArray(structured.technicalLimitations) && (
                    <ul className="space-y-1">
                      {structured.technicalLimitations.map((lim: string, i: number) => (
                        <li key={i}>• {lim}</li>
                      ))}
                    </ul>
                  )}
                  <p className="pt-1 text-slate-700">{analysis.disclaimer}</p>
                </section>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
