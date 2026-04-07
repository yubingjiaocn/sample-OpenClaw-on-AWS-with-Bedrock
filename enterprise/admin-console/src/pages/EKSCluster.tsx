/**
 * EKS components — imported by Settings (cluster/operator) and AgentList (instances).
 * Not a standalone page.
 */
import { useState } from 'react';
import {
  Cloud, Server, RefreshCw, Link2, Unlink, Download,
  Square, RotateCw, Terminal,
  Loader2, AlertTriangle, Box,
} from 'lucide-react';
import { Card, StatCard, Badge, Button, Table, Modal } from '../components/ui';
import {
  useEksCluster, useDiscoverClusters, useAssociateCluster, useDisassociateCluster,
  useEksInstances, useInstallOperator,
  useStopEksAgent, useReloadEksAgent, useEksAgentLogs,
} from '../hooks/useApi';

// ─── Cluster & Operator (for Settings page) ─────────────────────────────────

export function EksClusterTab() {
  const { data: cluster, isLoading, refetch } = useEksCluster();
  const discover = useDiscoverClusters();
  const associate = useAssociateCluster();
  const disassociate = useDisassociateCluster();
  const installOp = useInstallOperator();
  const [discovered, setDiscovered] = useState<any[]>([]);
  const [showDiscover, setShowDiscover] = useState(false);
  const [error, setError] = useState('');

  const handleDiscover = async () => {
    setError('');
    try {
      const result = await discover.mutateAsync();
      setDiscovered(result.clusters || []);
      setShowDiscover(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to discover clusters');
    }
  };

  const handleAssociate = async (name: string, region: string) => {
    setError('');
    try {
      await associate.mutateAsync({ name, region });
      setShowDiscover(false);
      refetch();
    } catch (e: any) {
      setError(e?.message || 'Failed to associate cluster');
    }
  };

  const handleDisassociate = async () => {
    if (!confirm('Remove cluster association? EKS agents will become unreachable.')) return;
    await disassociate.mutateAsync();
    refetch();
  };

  const handleInstallOperator = async () => {
    setError('');
    try {
      await installOp.mutateAsync({});
      refetch();
    } catch (e: any) {
      setError(e?.message || 'Failed to install operator');
    }
  };

  if (isLoading) {
    return <div className="flex items-center gap-2 text-text-muted py-12 justify-center"><Loader2 size={20} className="animate-spin" /> Loading cluster config...</div>;
  }

  const configured = cluster?.configured;
  const operator = cluster?.operator;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Cluster"
          value={configured ? cluster.cluster_name : 'Not configured'}
          subtitle={configured ? `${cluster.cluster_region} - K8s ${cluster.cluster_version}` : 'Associate an EKS cluster to enable'}
          icon={<Cloud size={20} />}
          color={configured ? 'success' : 'warning'}
        />
        <StatCard
          title="Operator"
          value={operator?.installed ? `v${operator.version}` : 'Not installed'}
          subtitle={operator?.installed ? `${operator.pods?.length || 0} pod(s) running` : configured ? 'Install to deploy agents' : 'Associate cluster first'}
          icon={<Box size={20} />}
          color={operator?.installed ? 'success' : configured ? 'warning' : 'info'}
        />
        <StatCard
          title="CRD"
          value={operator?.crd_exists ? 'Registered' : 'Missing'}
          subtitle={operator?.crd_exists ? 'OpenClawInstance v1alpha1' : 'Installed with operator'}
          icon={<Server size={20} />}
          color={operator?.crd_exists ? 'success' : 'info'}
        />
      </div>

      {/* Current cluster config */}
      {configured ? (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Associated Cluster</h3>
              <p className="text-sm text-text-muted mt-0.5">Connected to EKS cluster for agent deployment</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => refetch()}>
                <RefreshCw size={14} /> Refresh
              </Button>
              <Button size="sm" variant="danger" onClick={handleDisassociate}>
                <Unlink size={14} /> Disassociate
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-text-muted text-xs">Cluster Name</p>
              <p className="text-text-primary font-medium mt-0.5">{cluster.cluster_name}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Region</p>
              <p className="text-text-primary font-medium mt-0.5">{cluster.cluster_region}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Kubernetes Version</p>
              <p className="text-text-primary font-medium mt-0.5">{cluster.cluster_version}</p>
            </div>
            <div>
              <p className="text-text-muted text-xs">Endpoint</p>
              <p className="text-text-primary font-mono text-xs mt-0.5 truncate">{cluster.cluster_endpoint}</p>
            </div>
          </div>

          {/* Operator section */}
          {!operator?.installed && (
            <div className="mt-5 p-4 rounded-xl bg-warning/5 border border-warning/20">
              <div className="flex items-center gap-3">
                <AlertTriangle size={18} className="text-warning" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text-primary">OpenClaw Operator not installed</p>
                  <p className="text-xs text-text-muted mt-0.5">Install the operator to enable agent deployment on this cluster.</p>
                </div>
                <Button size="sm" variant="primary" onClick={handleInstallOperator} disabled={installOp.isPending}>
                  {installOp.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  Install Operator
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <div className="text-center py-8">
            <Cloud size={48} className="mx-auto text-text-muted mb-4" />
            <h3 className="text-lg font-semibold text-text-primary">No EKS Cluster Associated</h3>
            <p className="text-sm text-text-muted mt-1 max-w-md mx-auto">
              Discover and associate an EKS cluster to deploy OpenClaw agents on Kubernetes.
            </p>
            <Button variant="primary" className="mt-5" onClick={handleDiscover} disabled={discover.isPending}>
              {discover.isPending ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
              Discover EKS Clusters
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-sm text-danger">{error}</div>
      )}

      {/* Discover modal */}
      <Modal open={showDiscover} onClose={() => setShowDiscover(false)} title="Discover EKS Clusters" size="lg">
        {discovered.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">No EKS clusters found in this region.</p>
        ) : (
          <Table
            columns={[
              { key: 'name', label: 'Cluster Name', render: (c: any) => <span className="font-medium">{c.name}</span> },
              { key: 'status', label: 'Status', render: (c: any) => (
                <Badge color={c.status === 'ACTIVE' ? 'success' : c.status === 'CREATING' ? 'warning' : 'danger'} dot>
                  {c.status}
                </Badge>
              )},
              { key: 'version', label: 'K8s', render: (c: any) => c.version },
              { key: 'region', label: 'Region', render: (c: any) => c.region },
              { key: 'action', label: '', render: (c: any) => (
                <Button size="sm" variant="primary"
                  onClick={() => handleAssociate(c.name, c.region)}
                  disabled={c.status !== 'ACTIVE' || associate.isPending}>
                  {associate.isPending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                  Associate
                </Button>
              )},
            ]}
            data={discovered}
          />
        )}
      </Modal>
    </div>
  );
}

// ─── Instances List (for Agent Factory page) ─────────────────────────────────

export function EksInstancesTab() {
  const { data: cluster } = useEksCluster();
  const { data: instancesData, isLoading, refetch } = useEksInstances();
  const stopAgent = useStopEksAgent();
  const reloadAgent = useReloadEksAgent();
  const [logsAgent, setLogsAgent] = useState('');

  const instances = instancesData?.instances || [];
  const configured = cluster?.configured;
  const operatorReady = cluster?.operator?.installed;

  if (!configured) {
    return (
      <div className="text-center py-8 text-text-muted">
        <Server size={40} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">Associate an EKS cluster in Settings → EKS first.</p>
      </div>
    );
  }

  if (!operatorReady) {
    return (
      <div className="text-center py-8 text-text-muted">
        <Box size={40} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">Install the OpenClaw Operator in Settings → EKS first.</p>
      </div>
    );
  }

  const phaseColor = (phase: string) => {
    if (phase === 'Running') return 'success' as const;
    if (phase === 'Pending' || phase === 'Unknown') return 'warning' as const;
    return 'danger' as const;
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-text-muted">
          {instances.length} instance{instances.length !== 1 ? 's' : ''} in namespace <code className="text-xs bg-dark-hover px-1.5 py-0.5 rounded">{instancesData?.namespace}</code>
        </p>
        <Button size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
      ) : (
        <Table
          columns={[
            { key: 'name', label: 'Instance', render: (i: any) => (
              <div>
                <span className="font-medium text-text-primary">{i.name}</span>
                <span className="text-xs text-text-muted ml-2">{i.employee}</span>
              </div>
            )},
            { key: 'phase', label: 'Status', render: (i: any) => (
              <Badge color={phaseColor(i.phase)} dot>{i.phase}</Badge>
            )},
            { key: 'model', label: 'Model', render: (i: any) => (
              <span className="text-xs font-mono text-text-secondary">{i.model || '-'}</span>
            )},
            { key: 'position', label: 'Position', render: (i: any) => i.position },
            { key: 'created', label: 'Created', render: (i: any) => (
              <span className="text-xs text-text-muted">{i.created ? new Date(i.created).toLocaleDateString() : '-'}</span>
            )},
            { key: 'actions', label: 'Actions', render: (i: any) => (
              <div className="flex gap-1.5">
                <button onClick={() => reloadAgent.mutate({ agentId: i.name })} title="Reload"
                  className="p-1.5 rounded-lg hover:bg-dark-hover text-text-muted hover:text-primary transition-colors">
                  <RotateCw size={14} />
                </button>
                <button onClick={() => setLogsAgent(i.name)} title="Logs"
                  className="p-1.5 rounded-lg hover:bg-dark-hover text-text-muted hover:text-info transition-colors">
                  <Terminal size={14} />
                </button>
                <button onClick={() => { if (confirm(`Stop ${i.name}?`)) stopAgent.mutate(i.name); }} title="Stop"
                  className="p-1.5 rounded-lg hover:bg-dark-hover text-text-muted hover:text-danger transition-colors">
                  <Square size={14} />
                </button>
              </div>
            )},
          ]}
          data={instances}
          emptyText="No OpenClaw instances deployed. Create an agent with EKS deploy mode to get started."
        />
      )}

      {/* Logs modal */}
      {logsAgent && <LogsModal agentId={logsAgent} onClose={() => setLogsAgent('')} />}
    </div>
  );
}

function LogsModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { data, isLoading, refetch } = useEksAgentLogs(agentId);

  return (
    <Modal open={true} onClose={onClose} title={`Logs: ${agentId}`} size="lg">
      <div className="flex justify-end mb-2">
        <Button size="sm" onClick={() => refetch()}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-text-muted" /></div>
      ) : data?.logs ? (
        <pre className="bg-dark-bg rounded-xl p-4 text-xs text-text-secondary font-mono max-h-96 overflow-auto whitespace-pre-wrap">
          {data.logs}
        </pre>
      ) : (
        <p className="text-sm text-text-muted text-center py-4">No logs available.</p>
      )}
    </Modal>
  );
}
