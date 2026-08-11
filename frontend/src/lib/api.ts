const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const TOKEN_KEY = 'asf_token';

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
export type StageStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'VALIDATING'
  | 'SELF_HEALING'
  | 'GENERATED'
  | 'REVISION_REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ARCHIVED';
export type StageKey = 'PRD' | 'ARCHITECTURE' | 'UIUX' | 'ESTIMATION' | 'DATABASE' | 'BACKEND' | 'FRONTEND' | 'QA' | 'PACKAGE';

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  currentStage: StageKey | null;
  currentStageLabel: string | null;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string | null;
}

export interface AssignedTo {
  type: 'member' | 'team';
  id: string;
  label: string;
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
  assignedTo: AssignedTo | null;
  deadlineAt: string | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  businessIdea: string;
  knowledgeBaseId: string | null;
  aiModel: string;
  status: ProjectStatus;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  deadlineAt: string | null;
  stages: ProjectStage[];
}

// V1.2: artifact yang tersimpan di S3 (dicatat lewat StorageService.uploadArtifact()),
// diisi otomatis tiap kali n8n melaporkan satu stage selesai.
export interface ArtifactFile {
  id: string;
  artifactStageId: string;
  fileName: string;
  storageProvider: string;
  bucket: string;
  objectKey: string;
  size: number;
  mimeType: string;
  checksum: string;
  version: number;
  createdAt: string;
}

// V1.3 — progres+estimasi durasi generation file-by-file, lihat StagesController.progress()
export interface StageProgress {
  active: boolean;
  status?: 'RUNNING' | 'VALIDATING';
  totalFiles?: number;
  generatedFiles?: number;
  invalidFiles?: number;
  elapsedSeconds?: number;
  estimatedRemainingSeconds?: number | null;
  attempt?: number;
  maxAttempts?: number;
}

export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type MemberStatus = 'INVITED' | 'ACTIVE' | 'DEACTIVATED';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  preferredLanguage: string;
  organizationId: string | null;
  role: OrgRole | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  status: MemberStatus;
  invitedAt: string;
  joinedAt: string | null;
  invitedBy: string | null;
  user: { id: string; email: string; name: string | null };
}

export interface TeamMemberEntry {
  id: string;
  teamId: string;
  organizationMemberId: string;
  jobTitle: string | null;
  member: OrganizationMember;
}

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: string;
  members: TeamMemberEntry[];
}

export const api = {
  googleLoginUrl: () => `${API_URL}/auth/google`,

  login: (email: string, password: string) =>
    request<{ accessToken: string; user: { id: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMe: () => request<Me>('/auth/me', { method: 'POST' }),

  listProjects: () => request<ProjectSummary[]>('/projects'),
  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  createProject: (data: { name: string; businessIdea: string; knowledgeBaseId?: string; aiModel?: string }) =>
    request<ProjectSummary>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  decideStage: (
    projectId: string,
    stageKey: StageKey,
    decision: 'approved' | 'rejected' | 'revision_requested',
    comment?: string,
  ) =>
    request<ProjectStage>(`/projects/${projectId}/stages/${stageKey}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment }),
    }),

  assignStage: (
    projectId: string,
    stageKey: StageKey,
    data: { assignedMemberId?: string; assignedTeamId?: string },
  ) =>
    request<unknown>(`/projects/${projectId}/stages/${stageKey}/assignment`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  setProjectDeadline: (id: string, deadlineAt: string) =>
    request<unknown>(`/projects/${id}/deadline`, { method: 'PUT', body: JSON.stringify({ deadlineAt }) }),
  setStageDeadline: (projectId: string, stageKey: StageKey, deadlineAt: string) =>
    request<unknown>(`/projects/${projectId}/stages/${stageKey}/deadline`, {
      method: 'PUT',
      body: JSON.stringify({ deadlineAt }),
    }),

  // V1.2: daftar file yang tersimpan di S3 untuk satu stage, dan link download sementara (presigned URL, 15 menit)
  listStageFiles: (projectId: string, stageKey: StageKey) =>
    request<ArtifactFile[]>(`/projects/${projectId}/stages/${stageKey}/files`),
  getStageFileDownloadUrl: (projectId: string, stageKey: StageKey, fileId: string) =>
    request<{ url: string; expiresInSeconds: number }>(
      `/projects/${projectId}/stages/${stageKey}/files/${fileId}/download-url`,
    ),

  // V1.3 — progres real-time + estimasi durasi untuk stage yang lagi generate
  // file-by-file (UIUX, BACKEND, dan FRONTEND/DATABASE nanti). active:false
  // kalau tidak ada GenerationJob yang lagi jalan untuk stage ini.
  getStageProgress: (projectId: string, stageKey: StageKey) =>
    request<StageProgress>(`/projects/${projectId}/stages/${stageKey}/progress`),

  listMembers: (orgId: string) => request<OrganizationMember[]>(`/organizations/${orgId}/members`),
  inviteMember: (orgId: string, email: string, role: OrgRole) =>
    request<OrganizationMember>(`/organizations/${orgId}/members/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  resendInvite: (orgId: string, memberId: string) =>
    request<{ resent: boolean }>(`/organizations/${orgId}/members/${memberId}/resend-invite`, { method: 'POST' }),
  updateMember: (orgId: string, memberId: string, data: { role?: OrgRole; status?: MemberStatus }) =>
    request<OrganizationMember>(`/organizations/${orgId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  removeMember: (orgId: string, memberId: string) =>
    request<{ removed: boolean }>(`/organizations/${orgId}/members/${memberId}`, { method: 'DELETE' }),

  listTeams: (orgId: string) => request<Team[]>(`/organizations/${orgId}/teams`),
  createTeam: (orgId: string, name: string, description?: string) =>
    request<Team>(`/organizations/${orgId}/teams`, { method: 'POST', body: JSON.stringify({ name, description }) }),
  addTeamMember: (orgId: string, teamId: string, organizationMemberId: string, jobTitle?: string) =>
    request<TeamMemberEntry>(`/organizations/${orgId}/teams/${teamId}/members`, {
      method: 'POST',
      body: JSON.stringify({ organizationMemberId, jobTitle }),
    }),
  removeTeamMember: (orgId: string, teamId: string, teamMemberId: string) =>
    request<void>(`/organizations/${orgId}/teams/${teamId}/members/${teamMemberId}`, { method: 'DELETE' }),
};
