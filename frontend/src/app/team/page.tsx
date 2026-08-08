'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  getToken,
  clearToken,
  ApiError,
  type Me,
  type OrgRole,
  type OrganizationMember,
  type Team,
  type ProjectSummary,
  type ProjectDetail,
  type StageKey,
} from '@/lib/api';
import { useI18n } from '@/lib/i18n/I18nProvider';

const ROLE_OPTIONS: OrgRole[] = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'];

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-go/15 text-go border-go/30',
  INVITED: 'bg-signal/15 text-signal border-signal/30',
  DEACTIVATED: 'bg-stop/15 text-stop border-stop/30',
};

function toDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export default function TeamPage() {
  const router = useRouter();
  const { t } = useI18n();

  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('MEMBER');
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const [teamName, setTeamName] = useState('');
  const [teamDesc, setTeamDesc] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);

  const [addToTeam, setAddToTeam] = useState<Record<string, string>>({});

  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<'resend' | 'status' | 'role' | 'remove' | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [assigningStageKey, setAssigningStageKey] = useState<StageKey | null>(null);
  const [savingProjectDeadline, setSavingProjectDeadline] = useState(false);
  const [savingStageDeadlineKey, setSavingStageDeadlineKey] = useState<StageKey | null>(null);

  const canManage = me?.role === 'OWNER' || me?.role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const meData = await api.getMe();
      setMe(meData);
      if (!meData.organizationId) return;
      const [membersData, teamsData] = await Promise.all([
        api.listMembers(meData.organizationId),
        api.listTeams(meData.organizationId),
      ]);
      setMembers(membersData);
      setTeams(teamsData);

      if (meData.role === 'OWNER' || meData.role === 'ADMIN') {
        const projectsData = await api.listProjects();
        setProjects(projectsData);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        router.push('/login');
        return;
      }
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    }
  }, [router, t]);

  useEffect(() => {
    if (!getToken()) {
      router.push('/login');
      return;
    }
    load();
  }, [load, router]);

  const loadProjectDetail = useCallback(
    async (projectId: string) => {
      if (!projectId) {
        setProjectDetail(null);
        return;
      }
      try {
        const detail = await api.getProject(projectId);
        setProjectDetail(detail);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('error.serverError'));
      }
    },
    [t],
  );

  useEffect(() => {
    loadProjectDetail(selectedProjectId);
  }, [selectedProjectId, loadProjectDetail]);

  async function handleAssignStage(stageKey: StageKey, value: string) {
    if (!value || !selectedProjectId) return;
    setAssigningStageKey(stageKey);
    setError(null);
    try {
      const [type, id] = value.split(':');
      await api.assignStage(
        selectedProjectId,
        stageKey,
        type === 'member' ? { assignedMemberId: id } : { assignedTeamId: id },
      );
      await loadProjectDetail(selectedProjectId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setAssigningStageKey(null);
    }
  }

  async function handleSetProjectDeadline(value: string) {
    if (!value || !selectedProjectId) return;
    setSavingProjectDeadline(true);
    setError(null);
    try {
      await api.setProjectDeadline(selectedProjectId, value);
      await loadProjectDetail(selectedProjectId);
      await load(); // supaya badge deadline di daftar project ikut ter-update
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setSavingProjectDeadline(false);
    }
  }

  async function handleSetStageDeadline(stageKey: StageKey, value: string) {
    if (!value || !selectedProjectId) return;
    setSavingStageDeadlineKey(stageKey);
    setError(null);
    try {
      await api.setStageDeadline(selectedProjectId, stageKey, value);
      await loadProjectDetail(selectedProjectId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setSavingStageDeadlineKey(null);
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!me?.organizationId) return;
    setInviting(true);
    setInviteMsg(null);
    setError(null);
    try {
      await api.inviteMember(me.organizationId, inviteEmail, inviteRole);
      setInviteEmail('');
      setInviteRole('MEMBER');
      setInviteMsg(t('team.inviteSuccess'));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setInviting(false);
    }
  }

  async function handleResend(memberId: string) {
    if (!me?.organizationId) return;
    setBusyMemberId(memberId);
    setBusyAction('resend');
    setError(null);
    try {
      await api.resendInvite(me.organizationId, memberId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setBusyMemberId(null);
      setBusyAction(null);
    }
  }

  async function handleSetStatus(member: OrganizationMember, status: 'ACTIVE' | 'DEACTIVATED') {
    if (!me?.organizationId) return;
    setBusyMemberId(member.id);
    setBusyAction('status');
    setError(null);
    try {
      await api.updateMember(me.organizationId, member.id, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setBusyMemberId(null);
      setBusyAction(null);
    }
  }

  async function handleRoleChange(member: OrganizationMember, role: OrgRole) {
    if (!me?.organizationId) return;
    setBusyMemberId(member.id);
    setBusyAction('role');
    setError(null);
    try {
      await api.updateMember(me.organizationId, member.id, { role });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setBusyMemberId(null);
      setBusyAction(null);
    }
  }

  async function handleRemoveMember(member: OrganizationMember) {
    if (!me?.organizationId) return;
    if (!confirm(t('team.confirmRemoveMember'))) return;
    setBusyMemberId(member.id);
    setBusyAction('remove');
    setError(null);
    try {
      await api.removeMember(me.organizationId, member.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setBusyMemberId(null);
      setBusyAction(null);
    }
  }

  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!me?.organizationId) return;
    setCreatingTeam(true);
    setError(null);
    try {
      await api.createTeam(me.organizationId, teamName, teamDesc || undefined);
      setTeamName('');
      setTeamDesc('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    } finally {
      setCreatingTeam(false);
    }
  }

  async function handleAddTeamMember(teamId: string) {
    if (!me?.organizationId) return;
    const organizationMemberId = addToTeam[teamId];
    if (!organizationMemberId) return;
    try {
      await api.addTeamMember(me.organizationId, teamId, organizationMemberId);
      setAddToTeam((prev) => ({ ...prev, [teamId]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    }
  }

  async function handleRemoveTeamMember(teamId: string, teamMemberId: string) {
    if (!me?.organizationId) return;
    if (!confirm(t('team.confirmRemoveTeamMember'))) return;
    try {
      await api.removeTeamMember(me.organizationId, teamId, teamMemberId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('error.serverError'));
    }
  }

  if (!me) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-inkMuted">{error ?? t('dashboard.loading')}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/" className="font-display text-xs text-inkMuted hover:text-ink">
        {t('team.backToDashboard')}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-ink">{t('team.heading')}</h1>

      {error && <p className="mt-4 text-sm text-stop">{error}</p>}

      {!canManage && (
        <p className="mt-4 rounded-md border border-panelBorder bg-panel px-4 py-3 text-sm text-inkMuted">
          {t('team.notOwnerOrAdmin')}
        </p>
      )}

      {/* ===== Members ===== */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">{t('team.membersHeading')}</h2>

        <div className="mt-4 space-y-2">
          {members?.map((m) => {
            const isBusy = busyMemberId === m.id;
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-panelBorder bg-panel px-4 py-3"
              >
                <div className="min-w-[180px]">
                  <p className="text-sm text-ink">{m.user.name ?? m.user.email}</p>
                  <p className="font-display text-xs text-inkMuted">{m.user.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 font-display text-[11px] ${STATUS_BADGE[m.status]}`}>
                    {t(`team.status${m.status.charAt(0) + m.status.slice(1).toLowerCase()}`)}
                  </span>

                  {canManage ? (
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m, e.target.value as OrgRole)}
                      disabled={m.role === 'OWNER' || (isBusy && busyAction === 'role')}
                      className="rounded-md border border-panelBorder bg-floor px-2 py-1 font-display text-[11px] text-ink disabled:opacity-50"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="font-display text-[11px] text-inkMuted">{m.role}</span>
                  )}

                  {canManage && m.status === 'INVITED' && (
                    <button
                      onClick={() => handleResend(m.id)}
                      disabled={isBusy}
                      className="rounded-md border border-panelBorder px-2 py-1 font-display text-[11px] text-inkMuted transition hover:text-ink disabled:opacity-50"
                    >
                      {isBusy && busyAction === 'resend' ? '…' : t('team.resend')}
                    </button>
                  )}

                  {canManage && m.role !== 'OWNER' && (
                    <>
                      {m.status === 'ACTIVE' ? (
                        <button
                          onClick={() => handleSetStatus(m, 'DEACTIVATED')}
                          disabled={isBusy}
                          className="rounded-md border border-panelBorder px-2 py-1 font-display text-[11px] text-inkMuted transition hover:text-ink disabled:opacity-50"
                        >
                          {isBusy && busyAction === 'status' ? '…' : t('team.deactivate')}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSetStatus(m, 'ACTIVE')}
                          disabled={isBusy}
                          className="rounded-md border border-panelBorder px-2 py-1 font-display text-[11px] text-inkMuted transition hover:text-ink disabled:opacity-50"
                        >
                          {isBusy && busyAction === 'status' ? '…' : t('team.activate')}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemoveMember(m)}
                        disabled={isBusy}
                        className="rounded-md border border-stop/30 px-2 py-1 font-display text-[11px] text-stop transition hover:bg-stop/10 disabled:opacity-50"
                      >
                        {isBusy && busyAction === 'remove' ? '…' : t('team.remove')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {members?.length === 0 && <p className="text-sm text-inkMuted">{t('team.noMembers')}</p>}
        </div>

        {canManage && (
          <form onSubmit={handleInvite} className="mt-5 rounded-lg border border-panelBorder bg-panel p-5">
            <h3 className="font-display text-xs uppercase tracking-widest text-track">{t('team.inviteHeading')}</h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="mb-1 block text-xs text-inkMuted">{t('team.emailLabel')}</label>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-inkMuted">{t('team.roleLabel')}</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as OrgRole)}
                  className="rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
                >
                  {ROLE_OPTIONS.filter((r) => r !== 'OWNER').map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="rounded-md bg-track px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
              >
                {inviting ? t('team.inviting') : t('team.inviteButton')}
              </button>
            </div>
            {inviteMsg && <p className="mt-2 text-sm text-go">{inviteMsg}</p>}
          </form>
        )}
      </section>

      {/* ===== Teams ===== */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">{t('team.teamsHeading')}</h2>
        <p className="mt-1 text-sm text-inkMuted">{t('team.teamsSubheading')}</p>

        <div className="mt-4 space-y-4">
          {teams?.map((team) => (
            <div key={team.id} className="rounded-lg border border-panelBorder bg-panel p-5">
              <p className="font-medium text-ink">{team.name}</p>
              {team.description && <p className="mt-0.5 text-sm text-inkMuted">{team.description}</p>}

              <div className="mt-3 space-y-1.5">
                {team.members.map((tm) => (
                  <div key={tm.id} className="flex items-center justify-between text-sm">
                    <span className="text-ink">
                      {tm.member.user.name ?? tm.member.user.email}
                      {tm.jobTitle && <span className="text-inkMuted"> — {tm.jobTitle}</span>}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => handleRemoveTeamMember(team.id, tm.id)}
                        className="font-display text-[11px] text-stop hover:underline"
                      >
                        {t('team.remove')}
                      </button>
                    )}
                  </div>
                ))}
                {team.members.length === 0 && (
                  <p className="font-display text-xs text-inkMuted">{t('team.noMembers')}</p>
                )}
              </div>

              {canManage && (
                <div className="mt-4 flex items-center gap-2">
                  <select
                    value={addToTeam[team.id] ?? ''}
                    onChange={(e) => setAddToTeam((prev) => ({ ...prev, [team.id]: e.target.value }))}
                    className="flex-1 rounded-md border border-panelBorder bg-floor px-2 py-1.5 font-display text-[11px] text-ink focus:border-track focus:outline-none"
                  >
                    <option value="">{t('team.selectMember')}</option>
                    {members
                      ?.filter((m) => m.status === 'ACTIVE')
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.user.name ?? m.user.email}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => handleAddTeamMember(team.id)}
                    className="rounded-md border border-panelBorder px-3 py-1.5 font-display text-[11px] text-ink transition hover:border-track/50"
                  >
                    {t('team.addButton')}
                  </button>
                </div>
              )}
            </div>
          ))}

          {teams?.length === 0 && <p className="text-sm text-inkMuted">{t('team.noTeams')}</p>}
        </div>

        {canManage && (
          <form onSubmit={handleCreateTeam} className="mt-5 rounded-lg border border-panelBorder bg-panel p-5">
            <h3 className="font-display text-xs uppercase tracking-widest text-track">{t('team.createTeamHeading')}</h3>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="mb-1 block text-xs text-inkMuted">{t('team.teamNameLabel')}</label>
                <input
                  required
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  placeholder={t('team.teamNamePlaceholder')}
                  className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink placeholder:text-inkMuted focus:border-track focus:outline-none"
                />
              </div>
              <div className="flex-1 min-w-[180px]">
                <label className="mb-1 block text-xs text-inkMuted">{t('team.teamDescLabel')}</label>
                <input
                  value={teamDesc}
                  onChange={(e) => setTeamDesc(e.target.value)}
                  className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={creatingTeam}
                className="rounded-md bg-track px-4 py-2 text-sm font-medium text-floor transition hover:opacity-90 disabled:opacity-50"
              >
                {t('team.createTeamButton')}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ===== V1.2: Assignments + Deadline (pindah dari halaman project) ===== */}
      {canManage && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold text-ink">{t('team.assignmentsHeading')}</h2>
          <p className="mt-1 text-sm text-inkMuted">{t('team.assignmentsSubheading')}</p>

          <div className="mt-4 rounded-lg border border-panelBorder bg-panel p-5">
            <label className="mb-1 block text-xs text-inkMuted">{t('team.selectProjectLabel')}</label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="w-full rounded-md border border-panelBorder bg-floor px-3 py-2 text-sm text-ink focus:border-track focus:outline-none"
            >
              <option value="">{t('team.selectProjectPlaceholder')}</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {projectDetail && (
              <>
                {/* V1.2 FR-802: deadline tingkat project */}
                <div className="mt-4 flex items-center justify-between gap-2 rounded-md bg-floor px-3 py-2">
                  <span className="font-display text-[11px] uppercase tracking-widest text-inkMuted">
                    {t('team.projectDeadlineLabel')}
                  </span>
                  <input
                    type="date"
                    defaultValue={toDateInputValue(projectDetail.deadlineAt)}
                    disabled={savingProjectDeadline}
                    onChange={(e) => handleSetProjectDeadline(e.target.value)}
                    className="rounded-md border border-panelBorder bg-panel px-2 py-1 text-sm text-ink disabled:opacity-50"
                  />
                </div>

                <div className="mt-2 space-y-2">
                  {projectDetail.stages.map((stage) => {
                    const selectValue = stage.assignedTo ? `${stage.assignedTo.type}:${stage.assignedTo.id}` : '';
                    const isAssigning = assigningStageKey === stage.stageKey;
                    const isSavingDeadline = savingStageDeadlineKey === stage.stageKey;
                    return (
                      <div key={stage.stageKey} className="rounded-md bg-floor px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm text-ink">{stage.label}</span>
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={selectValue}
                              disabled={isAssigning}
                              onChange={(e) => handleAssignStage(stage.stageKey, e.target.value)}
                              className="min-w-[180px] rounded-md border border-panelBorder bg-panel px-2 py-1 text-sm text-ink disabled:opacity-50"
                            >
                              <option value="">{t('projectDetail.unassigned')}</option>
                              {members && members.length > 0 && (
                                <optgroup label={t('projectDetail.assignMemberGroup')}>
                                  {members
                                    .filter((m) => m.status === 'ACTIVE')
                                    .map((m) => (
                                      <option key={m.id} value={`member:${m.id}`}>
                                        {m.user.name ?? m.user.email}
                                      </option>
                                    ))}
                                </optgroup>
                              )}
                              {teams && teams.length > 0 && (
                                <optgroup label={t('projectDetail.assignTeamGroup')}>
                                  {teams.map((tm) => (
                                    <option key={tm.id} value={`team:${tm.id}`}>
                                      {tm.name}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            <input
                              type="date"
                              defaultValue={toDateInputValue(stage.deadlineAt)}
                              disabled={isSavingDeadline}
                              onChange={(e) => handleSetStageDeadline(stage.stageKey, e.target.value)}
                              title={t('team.stageDeadlineLabel')}
                              className="rounded-md border border-panelBorder bg-panel px-2 py-1 text-sm text-ink disabled:opacity-50"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {selectedProjectId && !projectDetail && (
              <p className="mt-4 text-sm text-inkMuted">{t('dashboard.loading')}</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
