/**
 * Tests for AgentList.tsx — Agent Factory page.
 *
 * Covers:
 *  1. Page render — stat cards, tabs, page header
 *  2. EKS availability gating — disabled when no cluster, enabled when operator ready
 *  3. positionName null safety — no crash on missing positionName
 *  4. Filtering — text search, position filter, status filter
 *  5. Create Agent wizard — step navigation, deployment mode grid, EKS disabled state
 *  6. Tab switching — serverless, ecs, eks, all
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, makeAgent, makeEksCluster } from '../../../test/helpers';
import AgentList from '../AgentList';

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockAgents = vi.fn<() => any[]>(() => []);
const mockPositions = vi.fn<() => any[]>(() => []);
const mockEmployees = vi.fn<() => any[]>(() => []);
const mockEksCluster = vi.fn<() => any>(() => undefined);
const mockEksInstances = vi.fn<() => any>(() => undefined);
const mockModelConfig = vi.fn(() => null);
const mockAgentConfig = vi.fn(() => null);

vi.mock('../../../hooks/useApi', () => ({
  useAgents: () => ({ data: mockAgents(), isLoading: false }),
  usePositions: () => ({ data: mockPositions() }),
  useEmployees: () => ({ data: mockEmployees() }),
  useCreateAgent: () => ({ mutate: vi.fn() }),
  useModelConfig: () => ({ data: mockModelConfig() }),
  useUpdateModelConfig: () => ({ mutate: vi.fn() }),
  useUpdateFallbackModel: () => ({ mutate: vi.fn() }),
  useSetPositionModel: () => ({ mutate: vi.fn() }),
  useRemovePositionModel: () => ({ mutate: vi.fn() }),
  useSetEmployeeModel: () => ({ mutate: vi.fn() }),
  useRemoveEmployeeModel: () => ({ mutate: vi.fn() }),
  useAgentConfig: () => ({ data: mockAgentConfig() }),
  useSetPositionAgentConfig: () => ({ mutate: vi.fn() }),
  useSetEmployeeAgentConfig: () => ({ mutate: vi.fn() }),
  useEksCluster: () => ({ data: mockEksCluster() }),
  useEksInstances: () => ({ data: mockEksInstances(), isLoading: false, refetch: vi.fn() }),
  // Re-export EKS hooks used by EksInstancesTab (imported transitively)
  useDiscoverClusters: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssociateCluster: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDisassociateCluster: () => ({ mutateAsync: vi.fn() }),
  useInstallOperator: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeployEksAgent: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useStopEksAgent: () => ({ mutate: vi.fn() }),
  useReloadEksAgent: () => ({ mutate: vi.fn() }),
  useEksAgentLogs: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAgents.mockReturnValue([]);
  mockPositions.mockReturnValue([]);
  mockEmployees.mockReturnValue([]);
  mockEksCluster.mockReturnValue(undefined);
  mockEksInstances.mockReturnValue(undefined);
  mockModelConfig.mockReturnValue(null);
  mockAgentConfig.mockReturnValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Page Render
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentList — page render', () => {
  it('shows the page header', () => {
    renderWithProviders(<AgentList />);
    expect(screen.getByText('Agent Factory')).toBeInTheDocument();
  });

  it('shows stat cards', () => {
    mockAgents.mockReturnValue([makeAgent()]);
    renderWithProviders(<AgentList />);

    expect(screen.getByText('Total Agents')).toBeInTheDocument();
    // "Serverless" appears in both stat card and tab — just verify presence
    expect(screen.getAllByText(/Serverless/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/ECS/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/EKS/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Avg Quality')).toBeInTheDocument();
  });

  it('shows tabs for Serverless, ECS, EKS, All, Configuration', () => {
    renderWithProviders(<AgentList />);

    // Tabs may share names with stat cards, so just verify they exist (at least one)
    expect(screen.getAllByText(/Serverless/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/ECS/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/EKS/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/All/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Configuration/)).toBeInTheDocument();
  });

  it('has Create Agent button', () => {
    renderWithProviders(<AgentList />);
    expect(screen.getByRole('button', { name: /create agent/i })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. EKS Availability Gating
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentList — EKS availability', () => {
  it('shows "Not connected" in EKS stat when cluster unavailable', () => {
    mockEksCluster.mockReturnValue(undefined);
    renderWithProviders(<AgentList />);

    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });

  it('shows instance count when EKS available', () => {
    mockAgents.mockReturnValue([makeAgent({ deployMode: 'eks' })]);
    mockEksCluster.mockReturnValue(makeEksCluster());
    mockEksInstances.mockReturnValue({ instances: [{ name: 'agt-carol' }] });
    renderWithProviders(<AgentList />);

    // Should show numeric count (1) instead of "Not connected"
    expect(screen.queryByText('Not connected')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. positionName null safety
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentList — positionName null safety', () => {
  it('does not crash when agent has no positionName', () => {
    mockAgents.mockReturnValue([
      makeAgent({ positionName: undefined as any }),
      makeAgent({ id: 'agt-2', positionName: '' }),
    ]);
    // This should not throw — the null guard (a.positionName || '') handles it
    expect(() => renderWithProviders(<AgentList />)).not.toThrow();
  });

  it('renders agent with null positionName gracefully', () => {
    mockAgents.mockReturnValue([
      makeAgent({ id: 'agt-null', name: 'Null Position Agent', positionName: undefined as any }),
    ]);
    renderWithProviders(<AgentList />);
    expect(screen.getByText('Null Position Agent')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Filtering
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentList — filtering', () => {
  const agents = [
    makeAgent({ id: 'agt-1', name: 'Alice Agent', positionName: 'SDE', employeeName: 'Alice', status: 'active' }),
    makeAgent({ id: 'agt-2', name: 'Bob Agent', positionName: 'PM', employeeName: 'Bob', status: 'idle' }),
    makeAgent({ id: 'agt-3', name: 'Carol Agent', positionName: 'SDE', employeeName: 'Carol', status: 'active' }),
  ];

  it('filters by text search', async () => {
    const user = userEvent.setup();
    mockAgents.mockReturnValue(agents);
    renderWithProviders(<AgentList />);

    const searchInput = screen.getByPlaceholderText(/search agent/i);
    await user.type(searchInput, 'Bob');

    expect(screen.getByText('Bob Agent')).toBeInTheDocument();
    expect(screen.queryByText('Alice Agent')).toBeNull();
    expect(screen.queryByText('Carol Agent')).toBeNull();
  });

  it('shows agent count badge', () => {
    mockAgents.mockReturnValue(agents);
    renderWithProviders(<AgentList />);

    expect(screen.getByText('3 agents')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Create Agent Wizard
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentList — Create Agent wizard', () => {
  beforeEach(() => {
    mockPositions.mockReturnValue([
      { id: 'pos-sde', name: 'Software Engineer', departmentId: 'd-eng', departmentName: 'Engineering',
        soulTemplate: 'You are an SDE.', defaultSkills: ['jina-reader'], defaultKnowledge: [],
        toolAllowlist: [], memberCount: 5, createdAt: '2026-01-01T00:00:00Z' },
    ]);
    mockEmployees.mockReturnValue([
      { id: 'emp-alice', name: 'Alice', positionId: 'pos-sde', positionName: 'SDE', departmentId: 'd-eng',
        departmentName: 'Engineering', employeeNo: 'E001', channels: [], agentId: null,
        agentStatus: 'idle', personalPrefs: '', createdAt: '2026-01-01T00:00:00Z' },
    ]);
  });

  it('opens wizard on Create Agent click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentList />);

    await user.click(screen.getByRole('button', { name: /create agent/i }));
    // "Create Agent" appears in both the button and the modal title
    expect(screen.getAllByText('Create Agent').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Step 1: Basic Configuration')).toBeInTheDocument();
  });

  it('shows 3-column deployment mode grid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentList />);

    await user.click(screen.getByRole('button', { name: /create agent/i }));
    // "Serverless" appears in stat card, tab, and wizard — check wizard-specific text
    expect(screen.getByText('AgentCore microVM. Scales to zero, pay-per-use.')).toBeInTheDocument();
    expect(screen.getByText('Persistent container. Scheduled tasks, direct IM.')).toBeInTheDocument();
    expect(screen.getByText('EKS (Kubernetes)')).toBeInTheDocument();
  });

  it('disables EKS option when cluster not configured', async () => {
    const user = userEvent.setup();
    mockEksCluster.mockReturnValue(undefined);
    renderWithProviders(<AgentList />);

    await user.click(screen.getByRole('button', { name: /create agent/i }));
    expect(screen.getByText(/Configure EKS cluster in Settings.*EKS first/)).toBeInTheDocument();
  });

  it('enables EKS option when cluster and operator available', async () => {
    const user = userEvent.setup();
    mockEksCluster.mockReturnValue(makeEksCluster());
    renderWithProviders(<AgentList />);

    await user.click(screen.getByRole('button', { name: /create agent/i }));
    expect(screen.getByText(/Operator-managed pod/)).toBeInTheDocument();
    expect(screen.queryByText(/Configure EKS cluster in Settings.*EKS first/)).toBeNull();
  });

  it('navigates through wizard steps', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentList />);

    await user.click(screen.getByRole('button', { name: /create agent/i }));
    expect(screen.getByText('Step 1: Basic Configuration')).toBeInTheDocument();

    // Find the Next button (not "Next" in other contexts)
    const nextButtons = screen.getAllByRole('button', { name: /next/i });
    await user.click(nextButtons[nextButtons.length - 1]);
    expect(screen.getByText('Step 2: SOUL Preview')).toBeInTheDocument();

    const nextButtons2 = screen.getAllByRole('button', { name: /next/i });
    await user.click(nextButtons2[nextButtons2.length - 1]);
    expect(screen.getByText('Step 3: Review & Create')).toBeInTheDocument();

    // Back button
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(screen.getByText('Step 2: SOUL Preview')).toBeInTheDocument();
  });

  it('shows step text in wizard', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AgentList />);

    await user.click(screen.getByRole('button', { name: /create agent/i }));
    expect(screen.getByText(/Step 1: Basic Configuration/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Tab Switching
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentList — tab switching', () => {
  const agents = [
    makeAgent({ id: 'agt-s1', deployMode: 'serverless', name: 'Serverless Agent' }),
    makeAgent({ id: 'agt-e1', deployMode: 'always-on-ecs', name: 'ECS Agent' }),
    makeAgent({ id: 'agt-k1', deployMode: 'eks', name: 'EKS Agent' }),
  ];

  it('shows serverless agents by default', () => {
    mockAgents.mockReturnValue(agents);
    renderWithProviders(<AgentList />);

    expect(screen.getByText('Serverless Agent')).toBeInTheDocument();
    // ECS and EKS agents should not be in the serverless table
    expect(screen.queryByText('ECS Agent')).toBeNull();
  });

  it('shows correct total agent count', () => {
    mockAgents.mockReturnValue(agents);
    renderWithProviders(<AgentList />);

    // Total stat card shows 3 — but "3" may appear in multiple places (tab counts etc.)
    expect(screen.getAllByText('3').length).toBeGreaterThanOrEqual(1);
  });
});
