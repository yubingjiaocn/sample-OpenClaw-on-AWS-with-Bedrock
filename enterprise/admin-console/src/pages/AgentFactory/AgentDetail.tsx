import { useParams, useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { useState } from 'react';
import { ArrowLeft, Edit3, MessageSquare, Eye, Loader, FolderOpen, RefreshCw, Trash2, Zap, AlertTriangle, Shield, Radio, Clock, Link2 } from 'lucide-react';
import { Card, Badge, Button, PageHeader, StatusDot, Modal, Tabs } from '../../components/ui';
import { useAgent, useAgents, usePositions, useEmployees, useBindings, useSessions, useAgentDailyUsage, useAlwaysOnStatus, useAlwaysOnChannels, useEnableAlwaysOn, useDisconnectChannel, useSecurityRuntimes, usePositionRuntimeMap, useModelConfig, useAuditEntries, useSetIMPlatforms } from '../../hooks/useApi';
import { api } from '../../api/client';
import { CHANNEL_LABELS } from '../../types';
import type { ChannelType } from '../../types';

const activityOpts: ApexOptions = {
  chart: { type: 'bar', toolbar: { show: false }, background: 'transparent' },
  colors: ['#6366f1'],
  plotOptions: { bar: { borderRadius: 3, columnWidth: '55%' } },
  grid: { borderColor: '#2e3039', strokeDashArray: 4 },
  xaxis: { labels: { style: { colors: '#64748b', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { style: { colors: '#64748b', fontSize: '11px' } } },
  tooltip: { theme: 'dark' },
  dataLabels: { enabled: false },
};

const tokenOpts: ApexOptions = {
  chart: { type: 'area', toolbar: { show: false }, background: 'transparent' },
  colors: ['#06b6d4', '#f59e0b'],
  stroke: { curve: 'smooth', width: 2 },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.05 } },
  grid: { borderColor: '#2e3039', strokeDashArray: 4 },
  xaxis: { labels: { style: { colors: '#64748b', fontSize: '11px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { style: { colors: '#64748b', fontSize: '11px' }, formatter: (v: number) => `${(v / 1000).toFixed(0)}k` } },
  tooltip: { theme: 'dark' },
  legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#94a3b8' } },
  dataLabels: { enabled: false },
};

export default function AgentDetail() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { data: agent, isLoading } = useAgent(agentId || '');
  const { data: allAgents = [] } = useAgents();
  const { data: positions = [] } = usePositions();
  const { data: allBindings = [] } = useBindings();
  const { data: allSessions = [] } = useSessions();
  const { data: dailyUsage = [] } = useAgentDailyUsage(agentId || '');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [agentTab, setAgentTab] = useState<'serverless' | 'always-on'>('serverless');
  const { data: auditData = [] } = useAuditEntries({ limit: 20 });
  const setIMPlatforms = useSetIMPlatforms();
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const empId = agent?.employeeId || '';
  const { data: aoStatus } = useAlwaysOnStatus(empId) as { data: any };
  const { data: aoChannels } = useAlwaysOnChannels(empId) as { data: any };
  const enableAO = useEnableAlwaysOn();
  const disconnectCh = useDisconnectChannel();
  const { data: runtimesData } = useSecurityRuntimes() as { data: any };
  const { data: posRuntimeMap } = usePositionRuntimeMap() as { data: any };
  const { data: mc } = useModelConfig() as { data: any };
  const { data: employees = [] } = useEmployees();
  const runtimes = (runtimesData as any)?.runtimes || [];
  const models = mc?.availableModels || [];
  // Lookup tier runtime config
  const tierRuntime = runtimes.find((rt: any) => {
    const posId = agent?.positionId || '';
    const mapped = posId ? (posRuntimeMap as any)?.map?.[posId] : undefined;
    return mapped === rt.id || rt.name?.toLowerCase().includes(aoStatus?.tier?.toLowerCase());
  });
  const tierModel = tierRuntime ? (models.find((m: any) => m.modelId === tierRuntime.model)?.modelName || tierRuntime.model?.split('/').pop()?.split(':')[0] || '—') : '—';
  // Position change detection
  const currentEmployee = employees.find((e: any) => e.id === empId);
  const positionMismatch = agent && currentEmployee && agent.positionId !== currentEmployee.positionId;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader size={24} className="animate-spin text-primary" /></div>;
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg text-text-muted mb-4">Agent Not Found</p>
        <Button variant="primary" onClick={() => navigate('/agents')}>Back to Agent List</Button>
      </div>
    );
  }

  const position = positions.find(p => p.id === agent.positionId);
  const bindings = allBindings.filter(b => b.agentId === agent.id);
  const sessions = allSessions.filter(s => s.agentId === agent.id);

  return (
    <div>
      <PageHeader
        title={agent.name}
        description={`${agent.positionName} · ${agent.employeeName}${agent.createdAt ? ` · Created ${new Date(agent.createdAt).toLocaleDateString()}` : ''}`}
        actions={
          <div className="flex gap-2">
            <Button variant="default" onClick={() => navigate('/agents')}><ArrowLeft size={16} /> Back</Button>
            <Button variant="default" onClick={() => navigate(`/agents/${agent.id}/soul`)}><Edit3 size={16} /> Edit SOUL</Button>
            <Button variant="default" onClick={() => navigate(`/playground?agent=${agent.id}`)}><MessageSquare size={16} /> Playground</Button>
            <Button variant="default" onClick={() => navigate(`/workspace?agent=${agent.id}`)}><FolderOpen size={16} /> Workspace</Button>
            <Button variant="default" onClick={async () => {
              try {
                await fetch(`/api/v1/admin/refresh-agent/${agent.employeeId}`, {
                  method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('openclaw_token')}` }
                });
                alert('Agent session terminated. Next message will trigger fresh assembly.');
              } catch { alert('Refresh failed'); }
            }}><RefreshCw size={16} /> Refresh</Button>
            <Button variant="default" onClick={() => setShowDelete(true)}><Trash2 size={16} /> Delete</Button>
          </div>
        }
      />

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6 mb-6">
        <Card>
          <p className="text-xs text-text-muted">Status</p>
          <div className="mt-1"><StatusDot status={agent.status} /></div>
        </Card>
        <Card>
          <p className="text-xs text-text-muted">Deploy Mode</p>
          <p className="mt-1 text-sm font-bold">{aoStatus?.enabled ? <><Zap size={14} className="inline text-success mr-1" />Dual Agent</> : <><Radio size={14} className="inline text-primary mr-1" />Serverless</>}</p>
        </Card>
        <Card>
          <p className="text-xs text-text-muted">Skills</p>
          <p className="mt-1 text-xl font-bold">{(agent.skills || []).length}</p>
        </Card>
        <Card>
          <p className="text-xs text-text-muted">Channels</p>
          <p className="mt-1 text-xl font-bold">{(agent.channels || []).length}</p>
        </Card>
        <Card>
          <p className="text-xs text-text-muted">Active Sessions</p>
          <p className="mt-1 text-xl font-bold text-success">{sessions.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-text-muted">Quality</p>
          <p className="mt-1 text-xl font-bold text-warning">⭐ {agent.qualityScore || '—'}</p>
        </Card>
      </div>

      {/* ── Dual Agent Tabs ── */}
      <Card className="mb-6">
        <Tabs
          tabs={[
            { id: 'serverless', label: '📡 Serverless Agent' },
            ...(aoStatus?.enabled ? [{ id: 'always-on', label: '⚡ Always-On Agent' }] : []),
          ]}
          activeTab={agentTab}
          onChange={t => setAgentTab(t as any)}
        />

        <div className="mt-4">
          {/* ── SERVERLESS TAB ── */}
          {agentTab === 'serverless' && (
            <div className="space-y-4">
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-3">
                <Radio size={16} className="text-primary shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">Serverless Agent — AgentCore microVM</p>
                  <p className="text-xs text-text-muted">On-demand execution via shared infrastructure. Storage: S3. ~10s cold start.</p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => navigate(`/workspace?agent=${agent.id}`)}>
                  <FolderOpen size={12} /> S3 Workspace
                </Button>
              </div>
            </div>
          )}

          {/* ── ALWAYS-ON TAB ── */}
          {agentTab === 'always-on' && aoStatus?.enabled && (
            <div className="space-y-4">
              {/* Position change warning */}
              {positionMismatch && (
                <div className="flex items-start gap-3 rounded-xl bg-warning/10 border border-warning/30 px-4 py-3">
                  <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text-primary">Position Changed — Container Needs Restart</p>
                    <p className="text-xs text-text-muted mt-0.5">
                      Employee moved from <strong>{agent?.positionName}</strong> to <strong>{currentEmployee?.positionName}</strong>.
                    </p>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => api.post(`/agents/${empId}/always-on/restart`, {}).then(() => window.location.reload())}>
                    <RefreshCw size={12} /> Restart Now
                  </Button>
                </div>
              )}

              {/* Fargate status */}
              <div className="rounded-xl bg-success/5 border border-success/20 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Zap size={16} className="text-success shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">Always-On Agent — ECS Fargate</p>
                    <p className="text-xs text-text-muted">24/7 container · EFS persistent storage · HEARTBEAT enabled</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={aoStatus.running ? 'success' : 'danger'}>{aoStatus.running ? 'Running' : aoStatus.ecsStatus || 'Stopped'}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => api.post(`/agents/${empId}/always-on/restart`, {}).then(() => window.location.reload())}><RefreshCw size={12} /> Restart</Button>
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => enableAO.mutate({ empId, enable: false })}>Stop</Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/workspace?agent=${agent.id}&type=always-on`)}><FolderOpen size={12} /> EFS Workspace</Button>
                </div>
              </div>

              {/* Runtime config grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Tier', value: aoStatus.tier },
                  { label: 'Model', value: tierModel },
                  { label: 'IAM Role', value: tierRuntime?.roleArn?.split('/').pop() || '—' },
                  { label: 'Guardrail', value: tierRuntime?.guardrailId || 'None' },
                  { label: 'Service', value: aoStatus.serviceName || '—' },
                  { label: 'Endpoint', value: aoStatus.endpoint || '—' },
                  { label: 'Est. Cost', value: `~$${aoStatus.tier === 'executive' || aoStatus.tier === 'engineering' ? '16' : '7'}/mo` },
                  { label: 'Storage', value: 'EFS (Persistent)' },
                ].map(r => (
                  <div key={r.label} className="rounded-lg bg-dark-bg px-3 py-2">
                    <p className="text-[10px] text-text-muted">{r.label}</p>
                    <p className="text-xs font-mono text-text-secondary truncate">{r.value}</p>
                  </div>
                ))}
              </div>

              {/* P1-A: IM Whitelist + Connections */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-text-primary flex items-center gap-2"><Link2 size={14} /> IM Channel Management</h4>
                </div>

                {/* Allowed platforms from position */}
                <div className="rounded-lg bg-surface-dim px-3 py-2">
                  <p className="text-[10px] text-text-muted mb-1.5">Allowed Platforms (from position: {agent.positionName})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['feishu', 'telegram', 'slack', 'discord', 'dingtalk', 'whatsapp'].map(p => {
                      const allowed = (position as any)?.allowedIMPlatforms;
                      const isAllowed = !allowed || allowed.length === 0 || allowed.includes(p);
                      return (
                        <span key={p} className={`text-[10px] px-2 py-0.5 rounded-full ${isAllowed ? 'bg-success/10 text-success' : 'bg-dark-bg text-text-muted line-through'}`}>
                          {isAllowed ? '✓' : '✗'} {p}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Connected channels */}
                {(aoChannels?.channels || []).length === 0 ? (
                  <p className="text-xs text-text-muted py-2">No IM channels connected. Employee can connect via Portal → Connect IM.</p>
                ) : (
                  <div className="space-y-1.5">
                    {(aoChannels?.channels || []).map((ch: any) => (
                      <div key={ch.channel} className="flex items-center justify-between rounded-lg bg-dark-bg px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Badge color="success">{ch.channel}</Badge>
                          <span className="text-xs text-text-muted">Connected {ch.connectedAt ? new Date(ch.connectedAt).toLocaleDateString() : ''}</span>
                        </div>
                        {confirmDisconnect === ch.channel ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-danger">Confirm?</span>
                            <Button variant="danger" size="sm" onClick={() => { disconnectCh.mutate({ empId, channel: ch.channel }); setConfirmDisconnect(null); }}>Yes</Button>
                            <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(null)}>No</Button>
                          </div>
                        ) : (
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDisconnect(ch.channel)}>
                            Disconnect
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* P1-B: IM Audit log inline */}
                <div className="rounded-lg bg-surface-dim px-3 py-2">
                  <p className="text-[10px] text-text-muted mb-1.5">Recent IM Events</p>
                  {(() => {
                    const imEvents = auditData.filter(e =>
                      (e.actorName === agent.employeeName || e.detail?.includes(empId)) &&
                      (['im_channel_connected', 'im_channel_disconnected', 'always_on_enabled', 'always_on_disabled', 'config_change'].includes(e.eventType))
                    ).slice(0, 5);
                    return imEvents.length === 0 ? (
                      <p className="text-xs text-text-muted">No IM events recorded yet.</p>
                    ) : (
                      <div className="space-y-1">
                        {imEvents.map((e, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="text-text-muted w-16 shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                            <Badge color={e.eventType.includes('connected') || e.eventType.includes('enabled') ? 'success' : 'danger'}>
                              {e.eventType.replace(/_/g, ' ')}
                            </Badge>
                            <span className="text-text-secondary truncate">{e.detail}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
        {/* Activity Stats */}
        <Card>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Activity Summary</h3>
          <div className="space-y-3">
            {[
              { label: 'Requests (7 days)', value: dailyUsage.reduce((s, d) => s + d.requests, 0), color: 'text-primary' },
              { label: 'Input tokens', value: `${(dailyUsage.reduce((s, d) => s + (d.inputTokens || 0), 0) / 1000).toFixed(1)}k`, color: 'text-info' },
              { label: 'Output tokens', value: `${(dailyUsage.reduce((s, d) => s + (d.outputTokens || 0), 0) / 1000).toFixed(1)}k`, color: 'text-warning' },
              { label: 'Est. cost', value: `$${dailyUsage.reduce((s, d) => s + (d.cost || 0), 0).toFixed(4)}`, color: 'text-success' },
              { label: 'Active sessions', value: sessions.length, color: 'text-success' },
              { label: 'Bindings', value: bindings.length, color: 'text-text-primary' },
              { label: 'Skills loaded', value: agent.skills?.length || 0, color: 'text-text-primary' },
              { label: 'Quality score', value: agent.qualityScore ? `${agent.qualityScore}/5` : '—', color: 'text-warning' },
            ].map(r => (
              <div key={r.label} className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                <span className="text-xs text-text-muted">{r.label}</span>
                <span className={`text-sm font-semibold ${r.color}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Daily Conversations */}
        <Card className="lg:col-span-2">
          <h3 className="text-lg font-semibold text-text-primary mb-1">Daily Conversations (7 days)</h3>
          <p className="text-sm text-text-secondary mb-3">Requests per day from DynamoDB records</p>
          {dailyUsage.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-text-muted text-sm">No conversation data yet</div>
          ) : (
            <Chart
              options={{ ...activityOpts, xaxis: { ...activityOpts.xaxis, categories: dailyUsage.map(d => d.date?.slice(5) || '') } }}
              series={[{ name: 'Conversations', data: dailyUsage.map(d => d.requests) }]}
              type="bar" height={260}
            />
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-6">
        {/* Token Usage */}
        <Card>
          <h3 className="text-lg font-semibold text-text-primary mb-2">Token Usage (7 days)</h3>
          {dailyUsage.length === 0 ? (
            <div className="flex items-center justify-center h-36 text-text-muted text-sm">No token data yet</div>
          ) : (
            <Chart
              options={{ ...tokenOpts, xaxis: { ...tokenOpts.xaxis, categories: dailyUsage.map(d => d.date?.slice(5) || '') } }}
              series={[
                { name: 'Input Tokens', data: dailyUsage.map(d => d.inputTokens || 0) },
                { name: 'Output Tokens', data: dailyUsage.map(d => d.outputTokens || 0) },
              ]}
              type="area" height={240}
            />
          )}
        </Card>

        {/* Configuration Summary */}
        <Card>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Configuration</h3>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-text-muted mb-1">Position</p>
              <p className="text-sm font-medium">{agent.positionName}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">Employee</p>
              <p className="text-sm font-medium">{agent.employeeName}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1.5">SOUL Versions</p>
              <div className="flex gap-1.5">
                <Badge>Global v{agent.soulVersions?.global ?? 0}</Badge>
                <Badge color="primary">Position v{agent.soulVersions?.position ?? 0}</Badge>
                <Badge color="success">Personal v{agent.soulVersions?.personal ?? 0}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1.5">Channels</p>
              <div className="flex gap-1.5">{(agent.channels || []).map(c => <Badge key={c} color="info">{CHANNEL_LABELS[c as ChannelType]}</Badge>)}</div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1.5">Skills ({(agent.skills || []).length})</p>
              <div className="flex flex-wrap gap-1.5">{(agent.skills || []).map(s => <Badge key={s} color="success">{s}</Badge>)}</div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1.5">Tool Permissions</p>
              <div className="flex flex-wrap gap-1.5">{(position?.toolAllowlist || []).map(t => <Badge key={t} color="info">{t}</Badge>)}</div>
            </div>
            <div>
              <p className="text-xs text-text-muted mb-1">Last Updated</p>
              <p className="text-sm text-text-secondary">{agent.updatedAt ? new Date(agent.updatedAt).toLocaleString() : '—'}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* (Always-On section moved into tabs above) */}

      {/* Active Sessions */}
      {sessions.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold text-text-primary mb-4">Active Sessions ({sessions.length})</h3>
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center justify-between rounded-lg bg-dark-bg p-3">
                <div className="flex items-center gap-3">
                  <div className="h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                  <div>
                    <p className="text-sm font-medium">{s.employeeName}</p>
                    <p className="text-xs text-text-muted">{(s.lastMessage || '').slice(0, 60)}{s.lastMessage?.length > 60 ? '...' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge color="info">{CHANNEL_LABELS[s.channel as ChannelType]}</Badge>
                  <span className="text-xs text-text-muted">{s.turns} turns</span>
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/monitor?session=${s.id}`)}><Eye size={14} /></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {showDelete && (
        <Modal open={true} onClose={() => setShowDelete(false)} title={`Delete Agent — ${agent.name}`}
          footer={
            <div className="flex justify-end gap-3">
              <Button variant="default" onClick={() => setShowDelete(false)}>Cancel</Button>
              <Button variant="primary" disabled={deleting} onClick={async () => {
                setDeleting(true);
                try {
                  await api.del(`/agents/${agent.id}`);
                  navigate('/agents');
                } catch (e: any) {
                  alert(e?.message || 'Delete failed');
                  setDeleting(false);
                }
              }}>{deleting ? 'Deleting...' : 'Delete Agent'}</Button>
            </div>
          }>
          <p className="text-sm text-text-secondary">
            This will permanently delete <strong>{agent.name}</strong> and:
          </p>
          <ul className="mt-2 space-y-1 text-sm text-text-muted list-disc pl-5">
            <li>Remove all bindings for this agent</li>
            <li>Clear agentId from the employee record</li>
            <li>Delete S3 workspace files</li>
          </ul>
          <div className="mt-4 rounded-lg bg-danger/10 border border-danger/20 px-3 py-2 text-xs text-danger">
            This action cannot be undone.
          </div>
        </Modal>
      )}
    </div>
  );
}
