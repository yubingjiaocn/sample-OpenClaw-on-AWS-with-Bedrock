/**
 * Shared test helpers: QueryClient wrapper, mock data factories, API mock utilities.
 */
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderOptions } from '@testing-library/react';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function TestProviders({ children }: { children: ReactNode }) {
  const qc = createTestQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: TestProviders, ...options });
}

// ─── Mock Data Factories ───────────────────────────────────────────────────

export function makeAgent(overrides: Partial<import('../types').Agent> = {}): import('../types').Agent {
  return {
    id: 'agt-carol',
    name: "Carol's Agent",
    employeeId: 'emp-carol',
    employeeName: 'Carol Chen',
    positionId: 'pos-sde',
    positionName: 'Software Engineer',
    status: 'active',
    soulVersions: { global: 1, position: 2, personal: 1 },
    skills: ['jina-reader'],
    channels: ['discord'],
    qualityScore: 4.5,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    deployMode: 'serverless',
    ...overrides,
  };
}

export function makeEksCluster(overrides: Record<string, any> = {}) {
  return {
    configured: true,
    in_cluster: false,
    cluster_name: 'openclaw-test',
    cluster_region: 'us-west-2',
    cluster_version: '1.31',
    cluster_endpoint: 'https://ABC.gr7.us-west-2.eks.amazonaws.com',
    operator: {
      installed: true,
      crd_exists: true,
      deployment_ready: true,
      namespace: 'openclaw-operator-system',
      version: '0.22.2',
      pods: [{ name: 'openclaw-operator-controller-manager-abc', phase: 'Running', ready: true }],
    },
    ...overrides,
  };
}

export function makeEksInstance(overrides: Record<string, any> = {}) {
  return {
    name: 'agt-carol',
    phase: 'Running',
    model: 'bedrock/claude-sonnet',
    employee: 'emp-carol',
    position: 'Software Engineer',
    created: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}
