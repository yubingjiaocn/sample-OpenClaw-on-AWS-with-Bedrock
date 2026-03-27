import { useState } from 'react';
import { Settings as SettingsIcon, Cpu, Server, Globe, Key, Zap, Shield, HardDrive, Database, Cloud, AlertTriangle, Lock, Check, X, Plus, Trash2 } from 'lucide-react';
import { Card, Badge, Button, PageHeader, Toggle, StatusDot, Table, Tabs, Modal, Select } from '../components/ui';
import { useModelConfig, useSecurityConfig, useServiceStatus, usePositions, useUpdateModelConfig, useUpdateFallbackModel, useUpdateSecurityConfig, useSetPositionModel, useRemovePositionModel } from '../hooks/useApi';

export default function Settings() {
  const { data: modelConfig } = useModelConfig();
  const { data: securityConfig } = useSecurityConfig();
  const updateDefault = useUpdateModelConfig();
  const updateFallback = useUpdateFallbackModel();
  const updateSecurity = useUpdateSecurityConfig();
  const setPositionModel = useSetPositionModel();
  const removePositionModel = useRemovePositionModel();
  const { data: services } = useServiceStatus();
  const { data: positions = [] } = usePositions();
  const [activeTab, setActiveTab] = useState('model');
  const [showChangeDefault, setShowChangeDefault] = useState(false);
  const [showChangeFallback, setShowChangeFallback] = useState(false);
  const [showAddOverride, setShowAddOverride] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [overridePosId, setOverridePosId] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const mc = modelConfig || { default: { modelId: '', modelName: 'Loading...', inputRate: 0, outputRate: 0 }, fallback: { modelId: '', modelName: '', inputRate: 0, outputRate: 0 }, positionOverrides: {}, availableModels: [] };
  const sc = securityConfig || { alwaysBlocked: [], piiDetection: { enabled: true, mode: 'redact' }, dataSovereignty: { enabled: true, region: '' }, conversationRetention: { days: 180 }, dockerSandbox: true, fastPathRouting: true, verboseAudit: false };
  const svc = services || { gateway: { status: 'unknown', port: 0, uptime: '', requestsToday: 0 }, auth_agent: { status: 'unknown', uptime: '', approvalsProcessed: 0 }, bedrock: { status: 'unknown', region: '', latencyMs: 0, vpcEndpoint: false }, dynamodb: { status: 'unknown', table: '', itemCount: 0 }, s3: { status: 'unknown', bucket: '' } };

  const modelOptions = mc.availableModels.map(m => ({ label: `${m.modelName} ($${m.inputRate}/$${m.outputRate})`, value: m.modelId }));
  const findModel = (id: string) => mc.availableModels.find(m => m.modelId === id);

  const handleChangeDefault = () => {
    const m = findModel(selectedModelId);
    if (m) {
      updateDefault.mutate({ modelId: m.modelId, modelName: m.modelName, inputRate: m.inputRate, outputRate: m.outputRate });
      setShowChangeDefault(false);
      setSelectedModelId('');
    }
  };

  const handleChangeFallback = () => {
    const m = findModel(selectedModelId);
    if (m) {
      updateFallback.mutate({ modelId: m.modelId, modelName: m.modelName, inputRate: m.inputRate, outputRate: m.outputRate });
      setShowChangeFallback(false);
      setSelectedModelId('');
    }
  };

  const handleAddOverride = () => {
    const m = findModel(selectedModelId);
    if (m && overridePosId) {
      setPositionModel.mutate({
        posId: overridePosId,
        modelId: m.modelId, modelName: m.modelName,
        inputRate: m.inputRate, outputRate: m.outputRate,
        reason: overrideReason || 'Custom model for this position',
      });
      setShowAddOverride(false);
      setSelectedModelId('');
      setOverridePosId('');
      setOverrideReason('');
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Platform configuration, model selection, security policies, and service health" />

      <Tabs
        tabs={[
          { id: 'model', label: 'LLM Provider' },
          { id: 'security', label: 'Security Policy' },
          { id: 'runtimes', label: 'Agent Runtimes' },
          { id: 'services', label: 'Service Status' },
        ]}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      <div className="mt-6">
        {activeTab === 'model' && (
          <div className="space-y-6">
            {/* Default + Fallback */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2"><Cpu size={18} className="text-primary" /><h3 className="text-sm font-semibold">Default Model</h3></div>
                  <Button variant="primary" size="sm" onClick={() => { setShowChangeDefault(true); setSelectedModelId(mc.default.modelId); }}>Change</Button>
                </div>
                <div className="rounded-2xl bg-surface-dim p-4 space-y-2">
                  <p className="text-lg font-semibold text-text-primary">{mc.default.modelName}</p>
                  <p className="text-xs text-text-muted font-mono">{mc.default.modelId}</p>
                  <div className="flex gap-3 mt-2">
                    <Badge color="success">Input: ${mc.default.inputRate}/1M</Badge>
                    <Badge color="success">Output: ${mc.default.outputRate}/1M</Badge>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2"><Zap size={18} className="text-warning" /><h3 className="text-sm font-semibold">Fallback Model</h3></div>
                  <Button variant="default" size="sm" onClick={() => { setShowChangeFallback(true); setSelectedModelId(mc.fallback.modelId); }}>Change</Button>
                </div>
                <div className="rounded-2xl bg-surface-dim p-4 space-y-2">
                  <p className="text-lg font-semibold text-text-primary">{mc.fallback.modelName || 'Not configured'}</p>
                  <p className="text-xs text-text-muted font-mono">{mc.fallback.modelId}</p>
                  <div className="flex gap-3 mt-2">
                    <Badge color="info">Input: ${mc.fallback.inputRate}/1M</Badge>
                    <Badge color="info">Output: ${mc.fallback.outputRate}/1M</Badge>
                  </div>
                </div>
              </Card>
            </div>

            {/* Per-Position Overrides */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">Per-Position Model Overrides</h3>
                  <p className="text-xs text-text-muted">Override the default model for specific positions that need different capabilities</p>
                </div>
                <Button variant="primary" size="sm" onClick={() => setShowAddOverride(true)}><Plus size={14} /> Add Override</Button>
              </div>
              {Object.keys(mc.positionOverrides).length === 0 ? (
                <div className="text-center py-6 text-text-muted">
                  <p className="text-sm">No position overrides configured</p>
                  <p className="text-xs mt-1">All positions use the default model. Add an override for positions that need a more capable (or cheaper) model.</p>
                </div>
              ) : (
                <Table
                  columns={[
                    { key: 'position', label: 'Position', render: (item: any) => <span className="font-medium">{item.posName}</span> },
                    { key: 'model', label: 'Model', render: (item: any) => (
                      <div><p className="text-sm">{item.modelName}</p><p className="text-xs text-text-muted font-mono">{item.modelId}</p></div>
                    )},
                    { key: 'pricing', label: 'Pricing', render: (item: any) => <span className="text-xs">${item.inputRate} / ${item.outputRate}</span> },
                    { key: 'reason', label: 'Reason', render: (item: any) => <span className="text-xs text-text-secondary">{item.reason}</span> },
                    { key: 'actions', label: '', render: (item: any) => (
                      <Button variant="ghost" size="sm" onClick={() => removePositionModel.mutate(item.posId)}><Trash2 size={14} /></Button>
                    )},
                  ]}
                  data={Object.entries(mc.positionOverrides).map(([posId, override]: [string, any]) => ({
                    posId,
                    posName: positions.find(p => p.id === posId)?.name || posId,
                    ...override,
                  }))}
                />
              )}
            </Card>

            {/* Available Models */}
            <Card>
              <h3 className="text-sm font-semibold text-text-primary mb-4">Available Models</h3>
              <p className="text-xs text-text-muted mb-4">Models available in your AWS Bedrock region. Click "Set as Default" to switch the organization's default model.</p>
              <div className="space-y-2">
                {mc.availableModels.map(m => {
                  const isDefault = m.modelId === mc.default.modelId;
                  const isFallback = m.modelId === mc.fallback.modelId;
                  return (
                    <div key={m.modelId} className={`flex items-center justify-between rounded-2xl px-4 py-3 transition-colors ${isDefault ? 'bg-primary/5 border border-primary/20' : isFallback ? 'bg-warning/5 border border-warning/20' : 'bg-surface-dim border border-transparent hover:border-dark-border/50'}`}>
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`w-2 h-2 rounded-full ${m.enabled ? 'bg-success' : 'bg-text-muted'}`} />
                        <div>
                          <p className="text-sm font-medium text-text-primary">{m.modelName}</p>
                          <p className="text-xs text-text-muted font-mono">{m.modelId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-text-muted">${m.inputRate}/1M in</span>
                        <span className="text-xs text-text-muted">${m.outputRate}/1M out</span>
                        {isDefault && <Badge color="primary">Default</Badge>}
                        {isFallback && <Badge color="warning">Fallback</Badge>}
                        {!isDefault && !isFallback && m.enabled && (
                          <Button variant="ghost" size="sm" onClick={() => {
                            updateDefault.mutate({ modelId: m.modelId, modelName: m.modelName, inputRate: m.inputRate, outputRate: m.outputRate });
                          }}>Set as Default</Button>
                        )}
                        {!m.enabled && <Badge>Disabled</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Info box */}
            <div className="rounded-2xl bg-info/5 border border-info/20 p-4 text-sm text-info">
              💡 Changing the default model takes effect on the next agent cold start (~15 min idle timeout). To apply immediately, stop active sessions from the Monitor page.
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-6">
            <Card>
              <div className="flex items-center gap-2 mb-4"><Shield size={18} className="text-danger" /><h3 className="text-sm font-semibold">Always Blocked Tools</h3></div>
              <div className="flex flex-wrap gap-2">
                {sc.alwaysBlocked.map((t: string) => <Badge key={t} color="danger">{t}</Badge>)}
              </div>
              <p className="mt-2 text-xs text-text-muted">These tools/patterns are blocked for ALL roles regardless of permissions</p>
            </Card>

            <Card>
              <h3 className="text-sm font-semibold text-text-primary mb-4">Security Policies</h3>
              <div className="space-y-3">
                {[
                  { key: 'piiDetection', label: 'PII Detection', desc: 'Detect and handle personally identifiable information', value: sc.piiDetection.enabled, extra: `Mode: ${sc.piiDetection.mode}` },
                  { key: 'dataSovereignty', label: 'Data Sovereignty', desc: 'Ensure all data stays within the configured AWS region', value: sc.dataSovereignty.enabled, extra: `Region: ${sc.dataSovereignty.region}` },
                  { key: 'dockerSandbox', label: 'Docker Sandbox', desc: 'Isolate code_execution tool calls in Docker containers', value: sc.dockerSandbox, toggle: true },
                  { key: 'fastPathRouting', label: 'Fast-Path Routing', desc: 'Skip Plan A evaluation for pre-approved tool+role combinations', value: sc.fastPathRouting, toggle: true },
                  { key: 'verboseAudit', label: 'Verbose Audit Logging', desc: 'Log full request/response payloads (increases storage cost)', value: sc.verboseAudit, toggle: true },
                ].map(p => (
                  <div key={p.key} className="flex items-center justify-between rounded-2xl bg-surface-dim p-4">
                    <div>
                      <p className="text-sm font-medium">{p.label}</p>
                      <p className="text-xs text-text-muted">{p.desc}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {p.extra && <Badge color="info">{p.extra}</Badge>}
                      {p.toggle ? (
                        <Toggle label="" checked={p.value} onChange={v => updateSecurity.mutate({ [p.key]: v })} />
                      ) : (
                        <Badge color={p.value ? 'success' : 'default'}>{p.value ? 'Enabled' : 'Disabled'}</Badge>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-2xl bg-surface-dim p-4">
                  <div>
                    <p className="text-sm font-medium">Conversation Retention</p>
                    <p className="text-xs text-text-muted">How long conversation logs are retained</p>
                  </div>
                  <Badge color="info">{sc.conversationRetention.days} days</Badge>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'runtimes' && (
          <div className="space-y-6">
            <div className="rounded-lg bg-info/5 border border-info/20 px-4 py-3 text-sm text-info">
              Different employee groups run in isolated AgentCore Runtimes — each with its own Docker image, default model, and IAM role.
              This provides infrastructure-level data isolation that cannot be bypassed by prompt injection.
            </div>

            {/* Runtime cards */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Standard Runtime */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Cpu size={20} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">Standard Runtime</h3>
                      <p className="text-xs text-text-muted">Engineering · Sales · HR · Finance</p>
                    </div>
                  </div>
                  <Badge color="success" dot>Active</Badge>
                </div>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                    <span className="text-text-muted">Docker Image</span>
                    <span className="font-mono text-text-secondary">multitenancy-agent:latest</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                    <span className="text-text-muted">Default Model</span>
                    <span className="text-text-secondary">Amazon Nova 2 Lite</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                    <span className="text-text-muted">IAM Role</span>
                    <span className="text-text-secondary">agentcore-execution-role</span>
                  </div>
                  <div className="rounded-lg bg-dark-bg px-3 py-2">
                    <p className="text-text-muted mb-1.5">IAM Permissions</p>
                    <div className="flex flex-wrap gap-1">
                      {['S3: own workspace only', 'DynamoDB: own partition', 'Bedrock: Nova models'].map(p => (
                        <span key={p} className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] text-success">{p}</span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-dark-bg px-3 py-2">
                    <p className="text-text-muted mb-1.5">Pre-installed Skills</p>
                    <div className="flex flex-wrap gap-1">
                      {['web-search', 'jina-reader', 'deep-research', 'github-pr', 's3-files'].map(s => (
                        <Badge key={s} color="default">{s}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Executive Runtime */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/10">
                      <Zap size={20} className="text-warning" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary">Executive Runtime</h3>
                      <p className="text-xs text-text-muted">C-Suite · Senior Leadership</p>
                    </div>
                  </div>
                  <Badge color="success" dot>Active</Badge>
                </div>
                <div className="space-y-3 text-xs">
                  <div className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                    <span className="text-text-muted">Docker Image</span>
                    <span className="font-mono text-text-secondary">exec-agent:latest</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                    <span className="text-text-muted">Default Model</span>
                    <span className="text-warning font-medium">Claude Sonnet 4.6 ✦</span>
                  </div>
                  <div className="flex justify-between rounded-lg bg-dark-bg px-3 py-2">
                    <span className="text-text-muted">IAM Role</span>
                    <span className="text-text-secondary">agentcore-exec-role</span>
                  </div>
                  <div className="rounded-lg bg-dark-bg px-3 py-2">
                    <p className="text-text-muted mb-1.5">IAM Permissions</p>
                    <div className="flex flex-wrap gap-1">
                      {['S3: full access (all buckets)', 'DynamoDB: all tables', 'Bedrock: all models'].map(p => (
                        <span key={p} className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">{p}</span>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-dark-bg px-3 py-2">
                    <p className="text-text-muted mb-1.5">Pre-installed Skills</p>
                    <p className="text-[10px] text-text-secondary">All {'>'}20 enterprise skills (shell · browser · analytics · integrations)</p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Security layers diagram */}
            <Card>
              <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Shield size={16} className="text-primary" /> Defense in Depth — Access Control Layers
              </h3>
              <div className="space-y-2">
                {[
                  { layer: 'L1 — Prompt', desc: 'SOUL.md rules ("never access finance data")', safe: false, label: 'Prompt-level · Can be bypassed by injection' },
                  { layer: 'L2 — Application', desc: 'Skills manifest allowedRoles / blockedRoles', safe: false, label: 'App-level · Code bug risk' },
                  { layer: 'L3 — IAM Role', desc: 'Runtime execution role has no permission on target resource', safe: true, label: 'Infrastructure · Cannot be bypassed' },
                  { layer: 'L4 — Network', desc: 'VPC isolation between Runtimes', safe: true, label: 'Infrastructure · Cannot be bypassed' },
                ].map(l => (
                  <div key={l.layer} className={`flex items-center gap-3 rounded-lg px-4 py-2.5 ${l.safe ? 'bg-success/5 border border-success/20' : 'bg-dark-bg border border-dark-border/40'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${l.safe ? 'bg-success' : 'bg-warning'}`} />
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs font-semibold mr-2 ${l.safe ? 'text-success' : 'text-text-primary'}`}>{l.layer}</span>
                      <span className="text-xs text-text-muted">{l.desc}</span>
                    </div>
                    <span className={`text-[10px] flex-shrink-0 ${l.safe ? 'text-success' : 'text-text-muted'}`}>{l.label}</span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Position → Runtime mapping (concept, read-only for now) */}
            <Card>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-text-primary">Position → Runtime Mapping</h3>
                <Badge color="info">Coming in v1.1</Badge>
              </div>
              <p className="text-xs text-text-muted mb-4">
                Route each position to a specific Runtime. Changes take effect on next agent cold start — no redeployment needed.
              </p>
              <div className="space-y-2">
                {[
                  { position: 'Solutions Architect', runtime: 'Standard', model: 'Nova 2 Lite' },
                  { position: 'Software Engineer', runtime: 'Standard', model: 'Nova 2 Lite' },
                  { position: 'Finance Analyst', runtime: 'Standard', model: 'Nova 2 Lite' },
                  { position: 'Executive', runtime: 'Executive ✦', model: 'Claude Sonnet 4.6', highlight: true },
                ].map(r => (
                  <div key={r.position} className={`flex items-center justify-between rounded-lg px-4 py-2.5 ${r.highlight ? 'bg-warning/5 border border-warning/20' : 'bg-dark-bg border border-dark-border/30'}`}>
                    <span className={`text-xs font-medium ${r.highlight ? 'text-warning' : 'text-text-primary'}`}>{r.position}</span>
                    <div className="flex items-center gap-3">
                      <Badge color={r.highlight ? 'warning' : 'default'}>{r.runtime}</Badge>
                      <span className="text-xs text-text-muted">{r.model}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'services' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { name: 'Gateway Proxy', icon: <Globe size={18} />, status: svc.gateway.status, details: [`Port: ${svc.gateway.port}`, `Uptime: ${svc.gateway.uptime}`, `Requests today: ${svc.gateway.requestsToday}`] },
              { name: 'Auth Agent', icon: <Shield size={18} />, status: svc.auth_agent.status, details: [`Uptime: ${svc.auth_agent.uptime}`, `Approvals: ${svc.auth_agent.approvalsProcessed}`] },
              { name: 'Bedrock', icon: <Cpu size={18} />, status: svc.bedrock.status, details: [`Region: ${svc.bedrock.region}`, `Latency: ${svc.bedrock.latencyMs}ms`, `VPC Endpoint: ${svc.bedrock.vpcEndpoint ? 'Yes' : 'No'}`] },
              { name: 'DynamoDB', icon: <Database size={18} />, status: svc.dynamodb.status, details: [`Table: ${svc.dynamodb.table}`, `Items: ${svc.dynamodb.itemCount}`] },
              { name: 'S3', icon: <Cloud size={18} />, status: svc.s3.status, details: [`Bucket: ${svc.s3.bucket}`] },
            ].map(s => (
              <Card key={s.name}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">{s.icon}<h3 className="text-sm font-semibold">{s.name}</h3></div>
                  <div className={`h-2.5 w-2.5 rounded-full ${s.status === 'running' || s.status === 'healthy' || s.status === 'connected' || s.status === 'active' ? 'bg-success animate-pulse' : 'bg-warning'}`} />
                </div>
                <div className="space-y-1">
                  {s.details.map((d, i) => <p key={i} className="text-xs text-text-muted">{d}</p>)}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Change Default Model Modal */}
      <Modal open={showChangeDefault} onClose={() => setShowChangeDefault(false)} title="Change Default Model"
        footer={<div className="flex justify-end gap-3">
          <Button variant="default" onClick={() => setShowChangeDefault(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleChangeDefault} disabled={!selectedModelId || updateDefault.isPending}>
            {updateDefault.isPending ? 'Saving...' : 'Apply'}
          </Button>
        </div>}
      >
        <p className="text-sm text-text-secondary mb-4">Select the default LLM model for all agents. This affects all positions without a specific override.</p>
        <Select label="Model" value={selectedModelId} onChange={setSelectedModelId} options={modelOptions} />
        {selectedModelId && findModel(selectedModelId) && (
          <div className="mt-4 rounded-2xl bg-surface-dim p-4 space-y-2">
            <p className="text-sm font-medium">{findModel(selectedModelId)!.modelName}</p>
            <p className="text-xs text-text-muted font-mono">{selectedModelId}</p>
            <div className="flex gap-3">
              <Badge color="success">Input: ${findModel(selectedModelId)!.inputRate}/1M</Badge>
              <Badge color="success">Output: ${findModel(selectedModelId)!.outputRate}/1M</Badge>
            </div>
          </div>
        )}
      </Modal>

      {/* Change Fallback Model Modal */}
      <Modal open={showChangeFallback} onClose={() => setShowChangeFallback(false)} title="Change Fallback Model"
        footer={<div className="flex justify-end gap-3">
          <Button variant="default" onClick={() => setShowChangeFallback(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleChangeFallback} disabled={!selectedModelId}>Apply</Button>
        </div>}
      >
        <p className="text-sm text-text-secondary mb-4">Fallback model is used when the default model is unavailable or rate-limited.</p>
        <Select label="Model" value={selectedModelId} onChange={setSelectedModelId} options={modelOptions} />
      </Modal>

      {/* Add Position Override Modal */}
      <Modal open={showAddOverride} onClose={() => { setShowAddOverride(false); setOverridePosId(''); setOverrideReason(''); }} title="Add Position Model Override"
        footer={<div className="flex justify-end gap-3">
          <Button variant="default" onClick={() => setShowAddOverride(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleAddOverride} disabled={!selectedModelId || !overridePosId || setPositionModel.isPending}>
            {setPositionModel.isPending ? 'Saving...' : 'Add Override'}
          </Button>
        </div>}
      >
        <p className="text-sm text-text-secondary mb-4">Assign a specific model to a position. Agents in this position will use this model instead of the default.</p>
        <div className="space-y-4">
          <Select label="Position" value={overridePosId} onChange={setOverridePosId}
            options={positions.filter(p => !mc.positionOverrides[p.id]).map(p => ({ label: `${p.name} (${p.departmentName})`, value: p.id }))}
            placeholder="Select position" />
          <Select label="Model" value={selectedModelId} onChange={setSelectedModelId} options={modelOptions} placeholder="Select model" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-primary">Reason</label>
            <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
              placeholder="e.g. Needs reasoning for architecture review"
              className="w-full rounded-2xl border border-dark-border/60 bg-surface-dim px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/60 focus:outline-none" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
