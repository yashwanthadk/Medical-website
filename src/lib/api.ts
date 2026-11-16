export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  role: string;
  hasPassword: boolean;
  createdAt?: string;
}

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

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

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
  register(payload: {
    email: string;
    displayName: string;
    password: string;
    confirmPassword: string;
  }) {
    return apiRequest<{ token: string; user: UserDTO }>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  login(payload: { email: string; password: string }) {
    return apiRequest<{ token: string; user: UserDTO }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  exchangeFirebaseToken(idToken: string) {
    return apiRequest<{ token: string; user: UserDTO }>('/api/v1/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  },

  forgotPassword(email: string) {
    return apiRequest<{
      message: string;
      verificationCode?: string;
      expiresInMinutes: number;
    }>('/api/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  resetPassword(payload: {
    email: string;
    code: string;
    newPassword: string;
    confirmPassword: string;
  }) {
    return apiRequest<{ message: string }>('/api/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  changePassword(
    payload: { currentPassword?: string; newPassword: string; confirmPassword: string },
    token: string
  ) {
    return apiRequest<{ message: string }>(
      '/api/v1/auth/change-password',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getMe(token: string) {
    return apiRequest<{ user: UserDTO }>('/api/v1/auth/me', {}, token);
  },

  logout(token: string | null) {
    return apiRequest<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }, token);
  },

  uploadFile(
    file: File,
    category: 'xray' | 'mri' | 'blood',
    token: string,
    onProgress?: (percent: number) => void
  ): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', resolveApiUrl('/api/v1/uploads'));
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

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
    payload: { fileId: string; title?: string; clinicalNotes?: string },
    token: string
  ) {
    return apiRequest<{
      reportId: string;
      analysisId: string;
      jobId: string;
      status: string;
    }>(
      `/api/v1/analysis/${type}`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getAnalysisStatus(analysisId: string, token: string) {
    return apiRequest<AnalysisJobStatus>(`/api/v1/analysis/${analysisId}/status`, {}, token);
  },

  getAnalysis(analysisId: string, token: string) {
    return apiRequest<AnalysisDetail>(`/api/v1/analysis/${analysisId}`, {}, token);
  },

  getDashboardSummary(token: string) {
    return apiRequest<DashboardSummary>('/api/v1/dashboard/summary', {}, token);
  },

  getHistory(params: { type?: string; q?: string }, token: string) {
    const search = new URLSearchParams();
    if (params.type && params.type !== 'all') search.set('type', params.type);
    if (params.q) search.set('q', params.q);
    const qs = search.toString();
    return apiRequest<{ items: HistoryItem[] }>(
      `/api/v1/history${qs ? `?${qs}` : ''}`,
      {},
      token
    );
  },

  getReportDetail(reportId: string, token: string) {
    return apiRequest<AnalysisDetail>(`/api/v1/history/${reportId}`, {}, token);
  },

  deleteReport(reportId: string, token: string) {
    return apiRequest<{ message: string }>(
      `/api/v1/history/${reportId}`,
      { method: 'DELETE' },
      token
    );
  },

  createChatSession(payload: { reportId?: string | null; title?: string }, token: string) {
    return apiRequest<ChatSessionDTO>(
      '/api/v1/chat/sessions',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getChatSessions(token: string) {
    return apiRequest<{ sessions: ChatSessionDTO[] }>('/api/v1/chat/sessions', {}, token);
  },

  getChatSession(sessionId: string, token: string) {
    return apiRequest<{ session: ChatSessionDTO; messages: ChatMessageDTO[] }>(
      `/api/v1/chat/sessions/${sessionId}`,
      {},
      token
    );
  },

  sendChatMessage(sessionId: string, message: string, token: string) {
    return apiRequest<{
      userMessage: ChatMessageDTO;
      assistantMessage: ChatMessageDTO;
    }>(
      `/api/v1/chat/sessions/${sessionId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      },
      token
    );
  },

  deleteChatSession(sessionId: string, token: string) {
    return apiRequest<{ message: string }>(
      `/api/v1/chat/sessions/${sessionId}`,
      { method: 'DELETE' },
      token
    );
  },
};
