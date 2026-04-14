import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../api/client';
import { useAuth } from './AuthContext';

type AgentType = 'serverless' | 'always-on';

interface PortalAgentContextValue {
  agentType: AgentType;
  setAgentType: (t: AgentType) => void;
  hasAlwaysOn: boolean;
  alwaysOnInfo: { tier?: string; status?: string; endpoint?: string; running?: boolean } | null;
  loading: boolean;
}

const PortalAgentContext = createContext<PortalAgentContextValue>({
  agentType: 'serverless',
  setAgentType: () => {},
  hasAlwaysOn: false,
  alwaysOnInfo: null,
  loading: true,
});

export function PortalAgentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [agentType, setAgentType] = useState<AgentType>('serverless');
  const [hasAlwaysOn, setHasAlwaysOn] = useState(false);
  const [alwaysOnInfo, setAlwaysOnInfo] = useState<PortalAgentContextValue['alwaysOnInfo']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    api.get<any>('/portal/my-agents').then(d => {
      const ao = d?.alwaysOn;
      if (ao?.enabled) {
        setHasAlwaysOn(true);
        setAlwaysOnInfo({
          tier: ao.tier,
          status: ao.status || ao.ecsStatus,
          endpoint: ao.endpoint,
          running: ao.status === 'running' || ao.running,
        });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user?.id]);

  return (
    <PortalAgentContext.Provider value={{ agentType, setAgentType, hasAlwaysOn, alwaysOnInfo, loading }}>
      {children}
    </PortalAgentContext.Provider>
  );
}

export function usePortalAgent() {
  return useContext(PortalAgentContext);
}
