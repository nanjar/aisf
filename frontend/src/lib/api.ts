const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'asf_token';

export { API_URL };

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message ?? `Request gagal (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type ProjectStatus = 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
export type StageStatus = 'PENDING' | 'GENERATED' | 'APPROVED' | 'REJECTED';
// V1.1: tambah PACKAGE (tahap Package Builder, ada gate approval seperti tahap lain)
export type StageKey =
  | 'PRD'
  | 'ARCHITECTURE'
  | 'ESTIMATION'
  | 'DATABASE'
  | 'BACKEND'
  | 'FRONTEND'
  | 'QA'
  | 'PACKAGE';

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  currentStage: StageKey | null;
  currentStageLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectStage {
  stageKey: StageKey;
  label: string;
  status: StageStatus;
  artifactName: string | null;
  content: string | null;
  comment: string | null;
  decidedBy: string | null;
  generatedAt: string | null;
  decidedAt: string | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  businessIdea: string;
  knowledgeBaseId: string | null;
  aiModel: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  stages: ProjectStage[];
}

/** V1.1: memicu download blob lewat elemen <a> sementara, lalu dibuang. */
export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; user: { id: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  // V1.1: bukan fetch biasa — ini navigasi penuh browser ke halaman consent Google,
  // jadi cukup kembalikan URL-nya, pemanggil yang set window.location.href.
  googleLoginUrl: () => `${API_URL}/auth/google`,

  listProjects: () => request<ProjectSummary[]>('/projects'),

  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  createProject: (data: { name: string; businessIdea: string; knowledgeBaseId?: string; aiModel?: string }) =>
    request<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  decideStage: (projectId: string, stageKey: StageKey, decision: 'approved' | 'rejected', comment?: string) =>
    request<ProjectStage>(`/projects/${projectId}/stages/${stageKey}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    }),

  // V1.1: respons bukan JSON (application/zip), jadi tidak lewat request() generik.
  downloadProject: async (id: string): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(`${API_URL}/projects/${id}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body.message ?? `Gagal mengunduh (${res.status})`);
    }
    return res.blob();
  },
};
