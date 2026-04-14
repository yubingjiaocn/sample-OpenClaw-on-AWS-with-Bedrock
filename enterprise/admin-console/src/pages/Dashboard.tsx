import { useNavigate } from 'react-router-dom';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import {
  Building2, Users, Bot, Link2, MessageSquare, Shield,
  TrendingUp, ArrowUpRight, ArrowDownRight, Zap, Activity,
  DollarSign, Clock, AlertTriangle, CheckCircle2, Circle,
} from 'lucide-react';
import { Card, StatCard, Badge, Button, PageHeader } from '../components/ui';
import { useDepartments, usePositions, useEmployees, useAgents, useSessions, useAuditEntries, useBindings, useUsageSummary, useUsageTrend, useApprovals, useAlertRules } from '../hooks/useApi';
import { CHANNEL_LABELS } from '../types';
import type { ChannelType } from '../types';

// Chart configs
const areaChartOpts: ApexOptions = {
  chart: { type: 'area', toolbar: { show: false }, sparkline: { enabled: false }, background: 'transparent' },
  colors: ['#6366f1', '#22c55e'],
  stroke: { curve: 'smooth', width: 2 },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0.05 } },
  grid: { borderColor: '#2e3039', strokeDashArray: 4, xaxis: { lines: { show: false } } },
  xaxis: {
    categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    labels: { style: { colors: '#64748b', fontSize: '12px' } },
    axisBorder: { show: false }, axisTicks: { show: false },
  },
  yaxis: { labels: { style: { colors: '#64748b', fontSize: '12px' } } },
  tooltip: { theme: 'dark' },
  legend: { position: 'top', horizontalAlign: 'right', labels: { colors: '#94a3b8' } },
  dataLabels: { enabled: false },
};

const donutOptsBase: Omit<ApexOptions, 'labels' | 'plotOptions'> = {
  chart: { type: 'donut', background: 'transparent' },
  colors: ['#6366f1', '#22c55e', '#f59e0b', '#06b6d4', '#ef4444'],
  stroke: { colors: ['#24262d'], width: 3 },
  legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
  dataLabels: { enabled: false },
  tooltip: { theme: 'dark' },
};

const barChartOptsBase: Omit<ApexOptions, 'xaxis'> = {
  chart: { type: 'bar', toolbar: { show: false }, background: 'transparent' },
  colors: ['#6366f1'],
  plotOptions: { bar: { borderRadius: 4, columnWidth: '50%' } },
  grid: { borderColor: '#2e3039', strokeDashArray: 4 },
  yaxis: { labels: { style: { colors: '#64748b', fontSize: '12px' } } },
  tooltip: { theme: 'dark' },
  dataLabels: { enabled: false },
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: DEPARTMENTS = [] } = useDepartments();
  const { data: POSITIONS = [] } = usePositions();
  const { data: EMPLOYEES = [] } = useEmployees();
  const { data: AGENTS = [] } = useAgents();
  const { data: LIVE_SESSIONS = [] } = useSessions();
  const { data: AUDIT_ENTRIES = [] } = useAuditEntries({ limit: 6 });
  const { data: BINDINGS = [] } = useBindings();
  const { data: usageSummary } = useUsageSummary();
  const { data: trend = [] } = useUsageTrend();
  const { data: approvalsData } = useApprovals();
  const { data: alertRules = [] } = useAlertRules();

  const activeSessions = LIVE_SESSIONS.filter(s => s.status === 'active').length;
  const todayInvocations = trend.length > 0 ? (trend[trend.length - 1]?.totalRequests || 0) : 0;
  const boundBindings = BINDINGS.filter(b => b.status === 'bound' || b.status === 'active').length;
  const unboundEmployees = EMPLOYEES.filter(e => !e.agentId);
  const pendingApprovals = approvalsData?.pending?.length || 0;
  const activeAlerts = alertRules.filter(a => a.status === 'warning').length;
  const topDepts = DEPARTMENTS.filter(d => !d.parentId);
  const qualityAgents = AGENTS.filter(a => a.qualityScore != null && a.qualityScore > 0);
  const avgQuality = qualityAgents.length > 0
    ? qualityAgents.reduce((s, a) => s + (a.qualityScore || 0), 0) / qualityAgents.length
    : null;
  const channelCounts: Record<string, number> = {};
  BINDINGS.forEach(b => { channelCounts[b.channel] = (channelCounts[b.channel] || 0) + 1; });
  const activeChannels = Object.keys(channelCounts).sort();
  const channelSeries = activeChannels.map(c => channelCounts[c] || 0);
  const agentsByPosition = POSITIONS.map(p => AGENTS.filter(a => a.positionId === p.id).length);

  // Setup checklist: first-time admin guidance
  const setupDone = {
    departments: DEPARTMENTS.length > 0,
    positions: POSITIONS.length > 0,
    employees: EMPLOYEES.length > 0,
    agents: AGENTS.length > 0,
    channels: Object.keys(channelCounts).length > 0,
  };
  const setupSteps = [
    { key: 'departments', label: 'Create departments', href: '/org/departments' },
    { key: 'positions', label: 'Create positions with SOUL & tools', href: '/org/positions' },
    { key: 'employees', label: 'Add employees', href: '/org/employees' },
    { key: 'agents', label: 'Create agents (or bulk provision)', href: '/agents' },
    { key: 'channels', label: 'Connect IM channels', href: '/channels' },
  ] as const;
  const setupComplete = Object.values(setupDone).every(Boolean);

  return (
    <div>
      <PageHeader title="Dashboard" description="Organization-wide AI digital workforce overview" />

      {/* Setup checklist — shown until all steps are complete */}
      {!setupComplete && (
        <div className="mb-6 rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-text-primary">Platform Setup Checklist</h3>
            <span className="ml-auto text-xs text-text-muted">{Object.values(setupDone).filter(Boolean).length} / {setupSteps.length} complete</span>
          </div>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
            {setupSteps.map(step => (
              <button key={step.key} onClick={() => navigate(step.href)}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors ${setupDone[step.key] ? 'bg-success/10 text-success' : 'bg-dark-bg text-text-muted hover:bg-dark-hover hover:text-text-primary'}`}>
                {setupDone[step.key]
                  ? <CheckCircle2 size={14} className="shrink-0" />
                  : <Circle size={14} className="shrink-0" />}
                {step.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        <StatCard title="Departments" value={topDepts.length} subtitle={`${DEPARTMENTS.length} total`} icon={<Building2 size={22} />} color="primary" />
        <StatCard title="Positions" value={POSITIONS.length} subtitle={`${POSITIONS.reduce((s, p) => s + p.memberCount, 0)} members`} icon={<Users size={22} />} color="info" />
        <StatCard title="Employees" value={EMPLOYEES.length} subtitle={`${EMPLOYEES.filter(e => e.agentId).length} with agents`} icon={<Users size={22} />} color="cyan" />
        <StatCard title="Agents" value={AGENTS.length} subtitle={`${todayInvocations} invocations today`} icon={<Bot size={22} />} color="success" />
        <StatCard title="Bindings" value={boundBindings} subtitle={`${Object.keys(channelCounts).length} channels`} icon={<Link2 size={22} />} color="warning" />
        <StatCard title="Live Sessions" value={activeSessions} subtitle="active in last 15 min" icon={<MessageSquare size={22} />} color="danger" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
        {/* Conversations trend */}
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Conversation Trends</h3>
              <p className="text-sm text-text-secondary">Weekly agent interactions & token usage</p>
            </div>
            <div className="flex gap-2">
              <span className="rounded-lg bg-primary/10 px-3 py-1 text-xs font-medium text-primary-light">Last 7 days</span>
            </div>
          </div>
          <Chart
            options={{...areaChartOpts, xaxis: { ...areaChartOpts.xaxis, categories: trend.map(t => t.date.slice(5)) }}}
            series={[
              { name: 'Conversations', data: trend.map(t => t.totalRequests) },
              { name: 'Cost ($)', data: trend.map(t => t.openclawCost) },
            ]}
            type="area"
            height={300}
          />
        </Card>

        {/* Agent distribution donut */}
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-text-primary">Agents by Position</h3>
            <p className="text-sm text-text-secondary">Distribution across roles</p>
          </div>
          <Chart options={{...donutOptsBase, labels: POSITIONS.map(p => p.name), plotOptions: { pie: { donut: { size: '70%', labels: { show: true, total: { show: true, label: 'Total', color: '#94a3b8', formatter: () => `${AGENTS.length}` } } } } }}} series={agentsByPosition} type="donut" height={300} />
        </Card>
      </div>

      {/* Middle row: Recent Activity + Quick Actions + Agent Status */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 mb-6">
        {/* Recent Activity */}
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary">Recent Activity</h3>
            <Button variant="ghost" size="sm" onClick={() => navigate('/audit')}>View all →</Button>
          </div>
          <div className="space-y-3">
            {AUDIT_ENTRIES.slice(0, 6).map(e => (
              <div key={e.id} className="flex items-center gap-3 rounded-lg p-2.5 hover:bg-dark-hover transition-colors">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  e.eventType === 'permission_denied' ? 'bg-danger/10 text-danger'
                  : e.eventType === 'config_change' ? 'bg-warning/10 text-warning'
                  : e.eventType === 'approval_decision' ? 'bg-info/10 text-info'
                  : 'bg-success/10 text-success'
                }`}>
                  {e.eventType === 'permission_denied' ? <Shield size={16} />
                    : e.eventType === 'config_change' ? <Zap size={16} />
                    : e.eventType === 'approval_decision' ? <AlertTriangle size={16} />
                    : <Activity size={16} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{e.actorName}</span>
                    <Badge color={e.status === 'success' ? 'success' : e.status === 'blocked' ? 'danger' : 'info'}>
                      {e.eventType.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted truncate">{e.detail}</p>
                </div>
                <span className="text-xs text-text-muted shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Right column: Needs Attention + Quick Actions + Agent Health */}
        <div className="space-y-6">
          {/* Needs Attention */}
          {(pendingApprovals > 0 || unboundEmployees.length > 0 || activeAlerts > 0) && (
            <Card>
              <h3 className="mb-3 text-lg font-semibold text-text-primary flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" /> Needs Attention
              </h3>
              <div className="space-y-2">
                {pendingApprovals > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-amber-500/5 border border-amber-500/20 px-3 py-2 cursor-pointer hover:bg-amber-500/10 transition-colors" onClick={() => navigate('/approvals')}>
                    <span className="text-sm">{pendingApprovals} pending approval{pendingApprovals > 1 ? 's' : ''}</span>
                    <Badge color="warning">Review</Badge>
                  </div>
                )}
                {unboundEmployees.length > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2 cursor-pointer hover:bg-blue-500/10 transition-colors" onClick={() => navigate('/bindings')}>
                    <span className="text-sm">{unboundEmployees.length} employee{unboundEmployees.length > 1 ? 's' : ''} without agents</span>
                    <Badge color="info">Provision</Badge>
                  </div>
                )}
                {activeAlerts > 0 && (
                  <div className="flex items-center justify-between rounded-lg bg-red-500/5 border border-red-500/20 px-3 py-2 cursor-pointer hover:bg-red-500/10 transition-colors" onClick={() => navigate('/monitor')}>
                    <span className="text-sm">{activeAlerts} active alert{activeAlerts > 1 ? 's' : ''}</span>
                    <Badge color="danger">Investigate</Badge>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <h3 className="mb-4 text-lg font-semibold text-text-primary">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" className="w-full" onClick={() => navigate('/org/employees')}>
                <Users size={16} /> Add Employee
              </Button>
              <Button variant="default" className="w-full" onClick={() => navigate('/agents')}>
                <Bot size={16} /> New Agent
              </Button>
              <Button variant="default" className="w-full" onClick={() => navigate('/bindings')}>
                <Link2 size={16} /> Bind Employee
              </Button>
              <Button variant="default" className="w-full" onClick={() => navigate('/playground')}>
                <MessageSquare size={16} /> Playground
              </Button>
            </div>
          </Card>

          {/* Agent Health */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">Agent Health</h3>
              <Button variant="ghost" size="sm" onClick={() => navigate('/monitor')}>View all →</Button>
            </div>
            <div className="space-y-3">
              {AGENTS.slice(0, 6).map(a => (
                <div key={a.id} onClick={() => navigate(`/agents/${a.id}`)} className="flex items-center justify-between rounded-lg p-2 hover:bg-dark-hover transition-colors cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-full ${a.status === 'active' ? 'bg-success' : 'bg-warning'}`} />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{a.name}</p>
                      <p className="text-xs text-text-muted">
                        {(a.channels || []).map(c => CHANNEL_LABELS[c as ChannelType]).join(', ') || 'No channels'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-warning">⭐ {a.qualityScore || '—'}</p>
                    <p className="text-xs text-text-muted">{a.skills.length} skills</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Bottom row: Channel distribution + Org overview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-text-primary">Channel Distribution</h3>
            <p className="text-sm text-text-secondary">Bindings per messaging platform</p>
          </div>
          <Chart options={{...barChartOptsBase, xaxis: { categories: activeChannels.map(c => CHANNEL_LABELS[c as ChannelType] || c), labels: { style: { colors: '#64748b', fontSize: '12px' } }, axisBorder: { show: false }, axisTicks: { show: false } }}} series={[{ name: 'Bindings', data: channelSeries }]} type="bar" height={260} />
        </Card>

        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-text-primary">Organization Overview</h3>
            <p className="text-sm text-text-secondary">Department structure & key metrics</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">Top Departments</p>
              <div className="space-y-2">
                {topDepts.map(d => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg bg-dark-bg/50 px-3 py-2">
                    <span className="text-sm text-text-primary">{d.name}</span>
                    <Badge color="info">{d.headCount}</Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">Key Metrics</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-dark-bg/50 px-3 py-2">
                  <span className="text-sm text-text-secondary">Avg Quality</span>
                  <span className="text-sm font-medium text-warning">⭐ {avgQuality !== null ? avgQuality.toFixed(1) : '—'}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-dark-bg/50 px-3 py-2">
                  <span className="text-sm text-text-secondary">Agent Coverage</span>
                  <span className="text-sm font-medium text-success">{EMPLOYEES.length > 0 ? Math.round(EMPLOYEES.filter(e => e.agentId).length / EMPLOYEES.length * 100) : 0}%</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-dark-bg/50 px-3 py-2">
                  <span className="text-sm text-text-secondary">Active Channels</span>
                  <span className="text-sm font-medium text-info">{Object.keys(channelCounts).length}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-dark-bg/50 px-3 py-2">
                  <span className="text-sm text-text-secondary">Today's Cost</span>
                  <span className="text-sm font-medium text-success">${usageSummary?.totalCost?.toFixed(2) || '0.00'}</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
