import { useState, useEffect } from 'react';
import {
  User, Globe, MessageSquare, Server,
  Eye, EyeOff, Check, X, RefreshCw, HardDrive,
  Cpu, MemoryStick, Wifi, WifiOff,
  ChevronDown,
} from 'lucide-react';
import { Card, Badge, Button, PageHeader, Tabs, Select } from '../components/ui';
import { EksClusterTab } from './EKSCluster';
import {
  useAdminAssistant, useUpdateAdminAssistant,
  useChangeAdminPassword, useSystemStats, useServiceStatus, useModelConfig,
  useEksDefaults, useUpdateEksDefaults,
} from '../hooks/useApi';
import type { EksDefaults } from '../hooks/useApi';
import { useAuth } from '../contexts/AuthContext';

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtBytes(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${b} B`;
}

function ProgressBar({ pct, color = 'primary' }: { pct: number; color?: string }) {
  const colors: Record<string, string> = {
    primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger',
  };
  const barColor = pct > 85 ? colors.danger : pct > 65 ? colors.warning : colors.success;
  return (
    <div className="h-1.5 w-full rounded-full bg-dark-border/40 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ─── Account Tab ─────────────────────────────────────────────────────────────

function AccountTab() {
  const { user } = useAuth();
  const changePw = useChangeAdminPassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const handleChange = async () => {
    if (next.length < 8) { setMsg({ ok: false, text: 'Password must be at least 8 characters' }); return; }
    if (next !== confirm) { setMsg({ ok: false, text: 'Passwords do not match' }); return; }
    try {
      await changePw.mutateAsync(next);
      setMsg({ ok: true, text: 'Password updated successfully' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch {
      setMsg({ ok: false, text: 'Failed to update password' });
    }
  };

  return (
    <div className="space-y-6 max-w-lg">
      {/* Profile */}
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <User size={16} className="text-primary" /> Admin Profile
        </h3>
        <div className="space-y-3">
          {[
            { label: 'Name', value: user?.name || 'Admin' },
            { label: 'Role', value: 'Administrator' },
            { label: 'Employee ID', value: user?.id || '—' },
          ].map(f => (
            <div key={f.label} className="flex items-center justify-between rounded-xl bg-surface-dim px-4 py-3">
              <span className="text-xs text-text-muted">{f.label}</span>
              <span className="text-sm text-text-primary font-medium">{f.value}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Password */}
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <User size={16} className="text-primary" /> Change Password
        </h3>
        <div className="space-y-3">
          {[
            { label: 'Current password', value: current, set: setCurrent },
            { label: 'New password', value: next, set: setNext },
            { label: 'Confirm new password', value: confirm, set: setConfirm },
          ].map(f => (
            <div key={f.label}>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">{f.label}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={f.value}
                  onChange={e => f.set(e.target.value)}
                  className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 pr-10 text-sm text-text-primary focus:border-primary/60 focus:outline-none"
                />
                <button onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
          ))}
          {msg && (
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs ${msg.ok ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
              {msg.ok ? <Check size={14} /> : <X size={14} />} {msg.text}
            </div>
          )}
          <Button variant="primary" className="w-full" disabled={changePw.isPending}
            onClick={handleChange}>
            {changePw.isPending ? 'Updating…' : 'Update Password'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ─── Interface Tab ────────────────────────────────────────────────────────────

function InterfaceTab() {
  const languages = [
    { code: 'en', name: 'English', flag: '🇺🇸', available: true },
    { code: 'zh', name: '中文 (简体)', flag: '🇨🇳', available: false },
    { code: 'ja', name: '日本語', flag: '🇯🇵', available: false },
  ];

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Globe size={16} className="text-primary" /> Language
        </h3>
        <div className="space-y-2">
          {languages.map(l => (
            <label key={l.code}
              className={`flex items-center justify-between rounded-xl px-4 py-3 transition-colors ${l.available ? 'bg-primary/10 border border-primary/30 cursor-pointer' : 'bg-surface-dim border border-transparent opacity-40 cursor-not-allowed'}`}>
              <div className="flex items-center gap-3">
                <span className="text-xl">{l.flag}</span>
                <span className={`text-sm font-medium ${l.available ? 'text-text-primary' : 'text-text-muted'}`}>{l.name}</span>
                {!l.available && <Badge color="default">Coming soon</Badge>}
              </div>
              <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${l.available ? 'border-primary bg-primary' : 'border-dark-border'}`}>
                {l.available && <div className="h-2 w-2 rounded-full bg-white" />}
              </div>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Multi-language support is in development. Chinese and Japanese interfaces are planned for a future release.
        </p>
      </Card>
    </div>
  );
}

// ─── Admin Assistant Tab ──────────────────────────────────────────────────────

const ALL_COMMANDS = [
  'list_employees', 'list_agents', 'get_agent', 'list_sessions', 'list_audit',
  'list_approvals', 'approve_request', 'deny_request', 'get_service_status',
  'get_model_config', 'update_model_config', 'list_user_mappings',
  'get_system_stats', 'list_knowledge_bases',
];

const COMMAND_DESCRIPTIONS: Record<string, string> = {
  list_employees: 'Query employee list and details',
  list_agents: 'List all AI agents and their status',
  get_agent: 'Get a specific agent\'s full configuration',
  list_sessions: 'View active and recent agent sessions',
  list_audit: 'Query audit log entries',
  list_approvals: 'View pending approval requests',
  approve_request: 'Approve a permission request',
  deny_request: 'Deny a permission request',
  get_service_status: 'Check health of platform services',
  get_model_config: 'Read current model configuration',
  update_model_config: 'Change the default model for agents',
  list_user_mappings: 'View employee IM channel mappings',
  get_system_stats: 'Read EC2 CPU / memory / disk stats',
  list_knowledge_bases: 'List configured knowledge bases',
};

function AdminAssistantTab() {
  const { data: cfg } = useAdminAssistant();
  const update = useUpdateAdminAssistant();
  const { data: mc } = useModelConfig();
  const [model, setModel] = useState('');
  const [commands, setCommands] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (cfg) {
      setModel(cfg.model || '');
      setCommands(cfg.allowedCommands || []);
      setExtra(cfg.systemPromptExtra || '');
    }
  }, [cfg]);

  const toggleCmd = (c: string) => setCommands(s => s.includes(c) ? s.filter(x => x !== c) : [...s, c]);

  const handleSave = async () => {
    await update.mutateAsync({ model, allowedCommands: commands, systemPromptExtra: extra });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const modelOptions = (mc?.availableModels || [])
    .filter(m => m.enabled)
    .map(m => ({ label: `${m.modelName} ($${m.inputRate}/$${m.outputRate})`, value: m.modelId }));

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <MessageSquare size={16} className="text-primary" /> Admin Assistant Model
        </h3>
        <p className="text-xs text-text-muted mb-4">
          The model used by the floating chat assistant (bottom-right corner).
          Choose a fast, cost-effective model for operational queries.
        </p>
        <Select label="Model" value={model} onChange={setModel}
          options={modelOptions} placeholder="Select model…" />
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
          <MessageSquare size={16} className="text-primary" /> Allowed Tools / Commands
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Select which backend tools the Admin Assistant can call. Restrict to limit what the AI can read or change.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALL_COMMANDS.map(c => {
            const on = commands.includes(c);
            return (
              <label key={c}
                className={`flex items-start gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${on ? 'bg-primary/10 border border-primary/30' : 'bg-surface-dim border border-transparent hover:border-dark-border/50'}`}>
                <input type="checkbox" checked={on} onChange={() => toggleCmd(c)} className="accent-primary mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-text-primary">{c}</p>
                  <p className="text-[10px] text-text-muted">{COMMAND_DESCRIPTIONS[c] || ''}</p>
                </div>
              </label>
            );
          })}
        </div>
      </Card>

      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-3">Extra System Prompt</h3>
        <p className="text-xs text-text-muted mb-3">Append additional instructions to the Admin Assistant's system prompt.</p>
        <textarea
          value={extra}
          onChange={e => setExtra(e.target.value)}
          rows={4}
          placeholder="e.g. Always respond in English. Never suggest deleting data without explicit confirmation."
          className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none resize-y"
        />
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={update.isPending}>
        {saved ? <><Check size={14} /> Saved</> : update.isPending ? 'Saving…' : 'Save Changes'}
      </Button>
    </div>
  );
}

// ─── System Tab ───────────────────────────────────────────────────────────────

function SystemTab() {
  const { data: stats, isLoading: statsLoading } = useSystemStats();
  const { data: services } = useServiceStatus();

  const svc = services || { gateway: { status: 'unknown', port: 0, uptime: '', requestsToday: 0 }, auth_agent: { status: 'unknown', uptime: '', approvalsProcessed: 0 }, bedrock: { status: 'unknown', region: '', latencyMs: 0, vpcEndpoint: false }, dynamodb: { status: 'unknown', table: '', itemCount: 0 }, s3: { status: 'unknown', bucket: '' } };

  return (
    <div className="space-y-6">
      {/* Resources */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* CPU */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Cpu size={16} className="text-primary" /><span className="text-sm font-semibold">CPU</span></div>
            {statsLoading ? <RefreshCw size={14} className="animate-spin text-text-muted" /> : null}
          </div>
          <p className="text-3xl font-bold text-text-primary mb-2">{stats?.cpu?.pct ?? '—'}<span className="text-sm font-normal text-text-muted ml-1">%</span></p>
          <ProgressBar pct={stats?.cpu?.pct || 0} />
        </Card>

        {/* Memory */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <MemoryStick size={16} className="text-primary" /><span className="text-sm font-semibold">Memory</span>
          </div>
          <p className="text-3xl font-bold text-text-primary mb-1">
            {stats?.memory?.pct ?? '—'}<span className="text-sm font-normal text-text-muted ml-1">%</span>
          </p>
          <ProgressBar pct={stats?.memory?.pct || 0} />
          <p className="text-xs text-text-muted mt-1.5">
            {stats?.memory ? `${fmtBytes(stats.memory.used)} / ${fmtBytes(stats.memory.total)}` : '—'}
          </p>
        </Card>

        {/* Disk */}
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <HardDrive size={16} className="text-primary" /><span className="text-sm font-semibold">Disk</span>
          </div>
          <p className="text-3xl font-bold text-text-primary mb-1">
            {stats?.disk?.pct ?? '—'}<span className="text-sm font-normal text-text-muted ml-1">%</span>
          </p>
          <ProgressBar pct={stats?.disk?.pct || 0} />
          <p className="text-xs text-text-muted mt-1.5">
            {stats?.disk ? `${fmtBytes(stats.disk.used)} used · ${fmtBytes(stats.disk.free)} free` : '—'}
          </p>
        </Card>
      </div>

      {/* Port Status */}
      <Card>
        <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
          <Wifi size={16} className="text-primary" /> Port Status
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(stats?.ports || []).map(p => (
            <div key={p.port} className={`rounded-xl px-4 py-3 border ${p.listening ? 'bg-success/5 border-success/20' : 'bg-danger/5 border-danger/20'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {p.listening ? <Wifi size={13} className="text-success" /> : <WifiOff size={13} className="text-danger" />}
                <span className="text-xs font-mono font-bold">{p.port}</span>
              </div>
              <p className="text-xs text-text-secondary">{p.name}</p>
              <Badge color={p.listening ? 'success' : 'danger'}>{p.listening ? 'Listening' : 'Down'}</Badge>
            </div>
          ))}
        </div>
      </Card>

      {/* Services */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { name: 'Gateway Proxy', status: svc.gateway.status, details: [`Port ${svc.gateway.port}`, `Uptime: ${svc.gateway.uptime}`, `Requests today: ${svc.gateway.requestsToday}`] },
          { name: 'Auth Agent', status: svc.auth_agent.status, details: [`Uptime: ${svc.auth_agent.uptime}`, `Approvals: ${svc.auth_agent.approvalsProcessed}`] },
          { name: 'Bedrock', status: svc.bedrock.status, details: [`Region: ${svc.bedrock.region}`, `Latency: ${svc.bedrock.latencyMs}ms`, svc.bedrock.vpcEndpoint ? 'VPC Endpoint ✓' : 'Public endpoint'] },
          { name: 'DynamoDB', status: svc.dynamodb.status, details: [svc.dynamodb.table, `${svc.dynamodb.itemCount} items`] },
          { name: 'S3', status: svc.s3.status, details: [svc.s3.bucket] },
        ].map(s => {
          const ok = ['running', 'healthy', 'connected', 'active'].includes(s.status);
          return (
            <Card key={s.name}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{s.name}</span>
                <div className={`h-2.5 w-2.5 rounded-full ${ok ? 'bg-success animate-pulse' : 'bg-warning'}`} />
              </div>
              <div className="space-y-0.5">
                {s.details.map((d, i) => <p key={i} className="text-xs text-text-muted">{d}</p>)}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── EKS Deployment Defaults ────────────────────────────────────────────────

function EksDefaultsSection() {
  const { data: defaults, isLoading } = useEksDefaults();
  const update = useUpdateEksDefaults();
  const [draft, setDraft] = useState<Partial<EksDefaults>>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (defaults) setDraft(defaults);
  }, [defaults]);

  const handleSave = () => {
    update.mutate(draft, {
      onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); },
    });
  };

  if (isLoading) return <div className="text-sm text-text-muted py-4">Loading EKS defaults...</div>;

  const set = (k: keyof EksDefaults, v: any) => setDraft(d => ({ ...d, [k]: v }));

  return (
    <Card className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">EKS Deployment Defaults</h3>
          <p className="text-sm text-text-muted mt-0.5">Default configuration applied when creating new EKS agents. Per-agent overrides available in Create Agent wizard.</p>
        </div>
        <Button variant="primary" onClick={handleSave} disabled={saved}>
          {saved ? <><Check size={14} /> Saved</> : 'Save Defaults'}
        </Button>
      </div>

      <div className="space-y-5">
        {/* Image */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Container Image</label>
            <input value={draft.image || ''} onChange={e => set('image', e.target.value)}
              placeholder="default: ghcr.io/openclaw/openclaw:latest"
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
            <p className="text-[10px] text-text-muted mt-1">Main OpenClaw container image (ECR URI for custom builds)</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Global Registry</label>
            <input value={draft.globalRegistry || ''} onChange={e => set('globalRegistry', e.target.value)}
              placeholder="e.g. 834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn"
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
            <p className="text-[10px] text-text-muted mt-1">Rewrites registry for ALL images (required for China regions)</p>
          </div>
        </div>

        {/* Model */}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Default Bedrock Model</label>
          <input value={draft.model || ''} onChange={e => set('model', e.target.value)}
            placeholder="bedrock/us.amazon.nova-2-lite-v1:0"
            className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
          <p className="text-[10px] text-text-muted mt-1">Leave blank to use platform default. Per-agent override available in Create Agent.</p>
        </div>

        {/* Resources */}
        <div>
          <p className="text-xs font-medium text-text-secondary mb-2">Compute Resources</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              ['cpuRequest', 'CPU Request', '500m'],
              ['cpuLimit', 'CPU Limit', '2'],
              ['memoryRequest', 'Memory Request', '2Gi'],
              ['memoryLimit', 'Memory Limit', '4Gi'],
            ] as const).map(([key, label, ph]) => (
              <div key={key}>
                <label className="mb-1 block text-[10px] font-medium text-text-muted">{label}</label>
                <input value={(draft as any)[key] || ''} onChange={e => set(key, e.target.value)}
                  placeholder={ph}
                  className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-3 py-2 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
              </div>
            ))}
          </div>
        </div>

        {/* Storage */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Storage Class</label>
            <input value={draft.storageClass || ''} onChange={e => set('storageClass', e.target.value)}
              placeholder="cluster default (efs-sc)"
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Storage Size</label>
            <input value={draft.storageSize || ''} onChange={e => set('storageSize', e.target.value)}
              placeholder="10Gi"
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
          </div>
        </div>

        {/* Toggles & Advanced */}
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={!!draft.chromium} onChange={e => set('chromium', e.target.checked)}
              className="rounded border-dark-border text-primary focus:ring-primary" />
            <span className="text-sm text-text-primary">Chromium Sidecar</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Runtime Class</label>
            <input value={draft.runtimeClass || ''} onChange={e => set('runtimeClass', e.target.value)}
              placeholder="e.g. kata-qemu"
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Service Type</label>
            <select value={draft.serviceType || ''} onChange={e => set('serviceType', e.target.value)}
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none">
              <option value="">ClusterIP (default)</option>
              <option value="LoadBalancer">LoadBalancer</option>
              <option value="NodePort">NodePort</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Node Selector (JSON)</label>
            <input value={draft.nodeSelector || ''} onChange={e => set('nodeSelector', e.target.value)}
              placeholder='{"katacontainers.io/kata-runtime": "true"}'
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Tolerations (JSON)</label>
            <input value={draft.tolerations || ''} onChange={e => set('tolerations', e.target.value)}
              placeholder='[{"key": "kata", "value": "true", "effect": "NoSchedule"}]'
              className="w-full rounded-xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary focus:border-primary/60 focus:outline-none" />
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const [tab, setTab] = useState('account');

  return (
    <div>
      <PageHeader title="Settings" description="Admin account, interface preferences, admin assistant configuration, and system health" />

      <Tabs
        tabs={[
          { id: 'account', label: 'Account' },
          { id: 'interface', label: 'Interface' },
          { id: 'assistant', label: 'Admin Assistant' },
          { id: 'eks', label: 'EKS' },
          { id: 'system', label: 'System' },
        ]}
        activeTab={tab}
        onChange={setTab}
      />

      <div className="mt-6">
        {tab === 'account' && <AccountTab />}
        {tab === 'interface' && <InterfaceTab />}
        {tab === 'assistant' && <AdminAssistantTab />}
        {tab === 'eks' && <><EksClusterTab /><EksDefaultsSection /></>}
        {tab === 'system' && <SystemTab />}
      </div>
    </div>
  );
}
