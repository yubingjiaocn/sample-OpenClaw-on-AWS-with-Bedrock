/**
 * Tests for BindIM.tsx — Portal IM binding page.
 *
 * Covers:
 *  1. EKS mode banner — shows "Always-on (EKS)" badge and Gateway Console button
 *  2. Serverless mode — does NOT show the Gateway Console button
 *  3. ECS mode — shows Gateway Console button
 *  4. GatewayConsoleButton click for EKS — opens with auth_token param (not token)
 *  5. GatewayConsoleButton click for ECS — uses directUrl with token param
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/helpers';
import BindIM from '../BindIM';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

import { api } from '../../../api/client';
const mockApiGet = api.get as ReturnType<typeof vi.fn>;

// Track window.open calls
const mockWindowOpen = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('open', mockWindowOpen);
  localStorage.setItem('openclaw_token', 'test-jwt-token');
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupApiMocks(overrides: {
  channelStatus?: { configured: string[] };
  channels?: Record<string, any>;
} = {}) {
  const channelStatus = overrides.channelStatus ?? { configured: ['telegram', 'discord'] };
  const channels = overrides.channels ?? {
    connected: [],
    deployMode: 'serverless',
    pairingMode: 'shared-gateway',
    pairingInstructions: {},
  };

  mockApiGet.mockImplementation((path: string) => {
    if (path === '/portal/im-channel-status') return Promise.resolve(channelStatus);
    if (path === '/portal/channels') return Promise.resolve(channels);
    return Promise.reject(new Error(`Unexpected API call: ${path}`));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EKS mode banner
// ═══════════════════════════════════════════════════════════════════════════════

describe('BindIM — EKS mode banner', () => {
  it('shows "Always-on (EKS)" text and Gateway Console button when deployMode is eks', async () => {
    setupApiMocks({
      channels: {
        connected: [],
        deployMode: 'eks',
        pairingMode: 'shared-gateway',
        pairingInstructions: {},
      },
    });

    renderWithProviders(<BindIM />);

    await waitFor(() => {
      expect(screen.getByText(/Always-on \(EKS\)/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /open gateway console/i })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Serverless mode
// ═══════════════════════════════════════════════════════════════════════════════

describe('BindIM — Serverless mode', () => {
  it('shows "Serverless" text and does NOT show Gateway Console button', async () => {
    setupApiMocks({
      channels: {
        connected: [],
        deployMode: 'serverless',
        pairingMode: 'shared-gateway',
        pairingInstructions: {},
      },
    });

    renderWithProviders(<BindIM />);

    await waitFor(() => {
      expect(screen.getByText('Serverless')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /open gateway console/i })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ECS mode
// ═══════════════════════════════════════════════════════════════════════════════

describe('BindIM — ECS mode', () => {
  it('shows "Always-on (ECS)" text and Gateway Console button', async () => {
    setupApiMocks({
      channels: {
        connected: [],
        deployMode: 'always-on-ecs',
        pairingMode: 'shared-gateway',
        pairingInstructions: {},
      },
    });

    renderWithProviders(<BindIM />);

    await waitFor(() => {
      expect(screen.getByText(/Always-on \(ECS\)/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /open gateway console/i })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GatewayConsoleButton click for EKS — uses auth_token param
// ═══════════════════════════════════════════════════════════════════════════════

describe('BindIM — GatewayConsoleButton EKS click', () => {
  it('opens gateway URL with auth_token param (not token) for EKS deploy mode', async () => {
    setupApiMocks({
      channels: {
        connected: [],
        deployMode: 'eks',
        pairingMode: 'shared-gateway',
        pairingInstructions: {},
      },
    });

    // Mock the direct fetch call used by GatewayConsoleButton
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        available: true,
        gatewayToken: 'gw-token-123',
        deployMode: 'eks',
        directUrl: null,
        dashboardToken: 'dash-token-abc',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup();
    renderWithProviders(<BindIM />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open gateway console/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /open gateway console/i }));

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    });

    const openedUrl = mockWindowOpen.mock.calls[0][0] as string;
    // EKS mode should use auth_token (not token) and proxy URL
    expect(openedUrl).toContain('auth_token=test-jwt-token');
    expect(openedUrl).not.toContain('token=gw-token-123');
    expect(openedUrl).toContain('/api/v1/portal/gateway/ui/');
    expect(openedUrl).toContain('#token=dash-token-abc');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GatewayConsoleButton click for ECS — uses directUrl with token param
// ═══════════════════════════════════════════════════════════════════════════════

describe('BindIM — GatewayConsoleButton ECS click', () => {
  it('opens directUrl with token param for ECS deploy mode', async () => {
    setupApiMocks({
      channels: {
        connected: [],
        deployMode: 'always-on-ecs',
        pairingMode: 'shared-gateway',
        pairingInstructions: {},
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({
        available: true,
        gatewayToken: 'gw-token-456',
        deployMode: 'always-on-ecs',
        directUrl: 'http://10.0.1.50:8098',
        dashboardToken: 'dash-token-def',
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup();
    renderWithProviders(<BindIM />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /open gateway console/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /open gateway console/i }));

    await waitFor(() => {
      expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    });

    const openedUrl = mockWindowOpen.mock.calls[0][0] as string;
    // ECS mode should use directUrl with token= param (not auth_token)
    expect(openedUrl).toContain('http://10.0.1.50:8098');
    expect(openedUrl).toContain('token=gw-token-456');
    expect(openedUrl).not.toContain('auth_token=');
    expect(openedUrl).toContain('#token=dash-token-def');
  });
});
