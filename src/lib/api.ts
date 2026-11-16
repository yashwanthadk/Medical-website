export interface UploadResponse {
  fileId: string;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  category: 'xray' | 'mri' | 'blood';
  isDuplicate: boolean;
  duplicateOfFileId: string | null;
  signedPreviewUrl: string;
  createdAt: string;
}

export interface AnalysisJobStatus {
  jobId: string;
  reportId: string;
  analysisId: string;
  jobType: 'xray' | 'mri' | 'blood';
  status: 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface BloodResultRow {
  id: string;
  test_name: string;
  measured_value: string;
  numeric_value: number | null;
  unit: string;
  reference_range: string;
  ref_min: number | null;
  ref_max: number | null;
  status: 'Normal' | 'High' | 'Low' | 'Unknown';
  simple_explanation: string;
  extraction_confidence: 'High' | 'Medium' | 'Low';
}

export interface AnalysisDetail {
  analysisId: string;
  reportId: string;
  reportType: 'xray' | 'mri' | 'blood';
  title: string;
  clinicalNotes: string;
  status: 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed';
  modelName: string;
  summaryPlain: string;
  structured: Record<string, any>;
  bloodResults: BloodResultRow[];
  extractedText?: string;
  limitations: string;
  disclaimer: string;
  urgentFlag: boolean;
  urgentReason: string;
  errorMessage: string | null;
  file: {
    fileId: string;
    originalFilename: string;
    mimeType: string;
    fileSize: number;
    signedPreviewUrl: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  metrics: {
    totalReports: number;
    xrayCount: number;
    mriCount: number;
    bloodCount: number;
    urgentCount: number;
    completedCount: number;
  };
  recentReports: Array<{
    reportId: string;
    analysisId: string | null;
    reportType: 'xray' | 'mri' | 'blood';
    title: string;
    status: string;
    urgentFlag: boolean;
    createdAt: string;
    summaryPlain: string | null;
  }>;
  bloodDistribution: Array<{ status: string; count: number }>;
}

export interface HistoryItem {
  reportId: string;
  analysisId: string | null;
  reportType: 'xray' | 'mri' | 'blood';
  title: string;
  clinicalNotes: string;
  status: string;
  urgentFlag: boolean;
  createdAt: string;
  updatedAt: string;
  summaryPlain: string | null;
  originalFilename: string | null;
}

export interface ChatSessionDTO {
  id: string;
  reportId: string | null;
  reportTitle?: string | null;
  reportType?: string | null;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const API_BASE = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env
  ?.VITE_API_BASE_URL || ''
).replace(/\/+$/, '');

const WORKSPACE_STORAGE_KEY = 'mediexplain_workspace_id';

export function getWorkspaceId(): string {
  try {
    let existing = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `ws-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, generated);
    return generated;
  } catch {
    return 'public-workspace';
  }
}

export function resolveApiUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalized}` : normalized;
}

function buildFriendlyHttpError(status: number, rawBody: string, parsedError?: string): string {
  if (parsedError && parsedError.trim()) {
    return parsedError;
  }
  if (status === 413) {
    return 'File is too large for the deployment request limit (4.5 MB max on serverless hosting). Please upload a compressed JPG/PNG or smaller PDF.';
  }
  if (status === 404) {
    return 'Backend API endpoint was not found (404). Verify serverless API deployment and routing.';
  }
  if (status === 502 || status === 504) {
    return 'The analysis server timed out or is temporarily unavailable. Please try again with a clearer/smaller file.';
  }
  if (rawBody && !rawBody.trim().startsWith('<')) {
    return rawBody.trim().slice(0, 220);
  }
  return `Request failed with status ${status}`;
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Workspace-Id', getWorkspaceId());

  const res = await fetch(resolveApiUrl(path), {
    ...options,
    headers,
  });

  const rawText = await res.text().catch(() => '');
  let data: Record<string, unknown> = {};
  if (rawText) {
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    const errMsg = typeof data.error === 'string' ? data.error : undefined;
    throw new Error(buildFriendlyHttpError(res.status, rawText, errMsg));
  }
  return data as T;
}

export const api = {
  uploadFile(
    file: File,
    category: 'xray' | 'mri' | 'blood',
    onProgress?: (percent: number) => void
  ): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', resolveApiUrl('/api/v1/uploads'));
      xhr.setRequestHeader('X-Workspace-Id', getWorkspaceId());

      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && onProgress) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      };

      xhr.onload = () => {
        const rawText = xhr.responseText || '';
        let parsed: Record<string, unknown> = {};
        try {
          parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
        } catch {
          parsed = {};
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed as unknown as UploadResponse);
        } else {
          const errMsg = typeof parsed.error === 'string' ? parsed.error : undefined;
          reject(new Error(buildFriendlyHttpError(xhr.status, rawText, errMsg)));
        }
      };

      xhr.onerror = () => reject(new Error('Network error occurred while uploading file.'));

      const form = new FormData();
      form.append('category', category);
      form.append('file', file);
      xhr.send(form);
    });
  },

  startAnalysis(
    type: 'xray' | 'mri' | 'blood',
    payload: { fileId: string; title?: string; clinicalNotes?: string }
  ) {
    return apiRequest<{
      reportId: string;
      analysisId: string;
      jobId: string;
      status: string;
    }>(`/api/v1/analysis/${type}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getAnalysisStatus(analysisId: string) {
    return apiRequest<AnalysisJobStatus>(`/api/v1/analysis/${analysisId}/status`);
  },

  getAnalysis(analysisId: string) {
    return apiRequest<AnalysisDetail>(`/api/v1/analysis/${analysisId}`);
  },

  getDashboardSummary() {
    return apiRequest<DashboardSummary>('/api/v1/dashboard/summary');
  },

  getHistory(params: { type?: string; q?: string }) {
    const search = new URLSearchParams();
    if (params.type && params.type !== 'all') search.set('type', params.type);
    if (params.q) search.set('q', params.q);
    const qs = search.toString();
    return apiRequest<{ items: HistoryItem[] }>(`/api/v1/history${qs ? `?${qs}` : ''}`);
  },

  getReportDetail(reportId: string) {
    return apiRequest<AnalysisDetail>(`/api/v1/history/${reportId}`);
  },

  deleteReport(reportId: string) {
    return apiRequest<{ message: string }>(`/api/v1/history/${reportId}`, {
      method: 'DELETE',
    });
  },

  createChatSession(payload: { reportId?: string | null; title?: string }) {
    return apiRequest<ChatSessionDTO>('/api/v1/chat/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getChatSessions() {
    return apiRequest<{ sessions: ChatSessionDTO[] }>('/api/v1/chat/sessions');
  },

  getChatSession(sessionId: string) {
    return apiRequest<{ session: ChatSessionDTO; messages: ChatMessageDTO[] }>(
      `/api/v1/chat/sessions/${sessionId}`
    );
  },

  sendChatMessage(sessionId: string, message: string) {
    return apiRequest<{
      userMessage: ChatMessageDTO;
      assistantMessage: ChatMessageDTO;
    }>(`/api/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  deleteChatSession(sessionId: string) {
    return apiRequest<{ message: string }>(`/api/v1/chat/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  },
};
