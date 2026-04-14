import { ReactNode, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageSquare, User, BarChart3, Puzzle, FileText, LogOut, Sun, Moon, Link2, ArrowLeft, Bot, Zap, Radio } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { PortalAgentProvider, usePortalAgent } from '../contexts/PortalAgentContext';
import { api } from '../api/client';
import ClawForgeLogo from './ClawForgeLogo';
import clsx from 'clsx';

const NAV = [
  { label: 'Chat', href: '/portal', icon: <MessageSquare size={20} /> },
  { label: 'My Agents', href: '/portal/agents', icon: <Bot size={20} /> },
  { label: 'My Profile', href: '/portal/profile', icon: <User size={20} /> },
  { label: 'My Usage', href: '/portal/usage', icon: <BarChart3 size={20} /> },
  { label: 'My Skills', href: '/portal/skills', icon: <Puzzle size={20} /> },
  { label: 'My Requests', href: '/portal/requests', icon: <FileText size={20} /> },
  { label: 'Connect IM', href: '/portal/channels', icon: <Link2 size={20} /> },
];

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PortalAgentProvider>
      <PortalLayoutInner>{children}</PortalLayoutInner>
    </PortalAgentProvider>
  );
}

function PortalLayoutInner({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const { agentType, setAgentType, hasAlwaysOn, alwaysOnInfo, loading: aoLoading } = usePortalAgent();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendingCount, setPendingCount] = useState(0);

  // Poll for pending requests to show notification badge
  useEffect(() => {
    const load = () => api.get<any>('/portal/requests').then(d => setPendingCount(d?.pending?.length || 0)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-dark-border bg-dark-sidebar">
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-dark-border px-4">
          <ClawForgeLogo size={32} animate="idle" />
          <div>
            <div className="text-sm font-semibold text-text-primary">OpenClaw Portal</div>
            <div className="text-xs text-text-muted">{user?.name || 'Employee'}</div>
          </div>
        </div>

        {/* Agent Switcher */}
        {!aoLoading && (
          <div className="px-3 pt-3 pb-1">
            <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5 px-1">Active Agent</p>
            <div className="space-y-1">
              <button
                onClick={() => setAgentType('serverless')}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors',
                  agentType === 'serverless'
                    ? 'bg-primary/10 border border-primary/30 text-primary-light font-medium'
                    : 'text-text-muted hover:bg-dark-hover hover:text-text-primary border border-transparent'
                )}
              >
                <Radio size={14} />
                <span className="flex-1 text-left">Serverless</span>
                {agentType === 'serverless' && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
              {hasAlwaysOn ? (
                <button
                  onClick={() => setAgentType('always-on')}
                  className={clsx(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors',
                    agentType === 'always-on'
                      ? 'bg-success/10 border border-success/30 text-success font-medium'
                      : 'text-text-muted hover:bg-dark-hover hover:text-text-primary border border-transparent'
                  )}
                >
                  <Zap size={14} />
                  <span className="flex-1 text-left">Always-On{alwaysOnInfo?.tier ? ` · ${alwaysOnInfo.tier}` : ''}</span>
                  {alwaysOnInfo?.running && <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />}
                </button>
              ) : (
                <div className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-text-muted/50 border border-transparent">
                  <Zap size={14} />
                  <span className="flex-1">Always-On · Not configured</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV.map(item => (
            <button
              key={item.href}
              onClick={() => navigate(item.href)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                location.pathname === item.href
                  ? 'bg-primary/10 text-primary-light font-medium'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary'
              )}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {item.href === '/portal/requests' && pendingCount > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning px-1.5 text-[10px] font-bold text-white">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Back to Admin (admin/manager only) */}
        {(user?.role === 'admin' || user?.role === 'manager') && (
          <div className="px-3 pb-1">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary-light hover:bg-primary/10 transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Admin Console
            </button>
          </div>
        )}

        {/* Theme + User + Logout */}
        <div className="border-t border-dark-border p-3">
          <button
            onClick={toggleTheme}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 mb-2 text-text-muted hover:bg-dark-hover hover:text-text-primary transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          >
            <span className="relative w-5 h-5">
              <Sun size={18} className={clsx('absolute inset-0 transition-all duration-500', theme === 'light' ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50')} />
              <Moon size={18} className={clsx('absolute inset-0 transition-all duration-500', theme === 'dark' ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50')} />
            </span>
            <span className="text-sm">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 text-sm font-medium">
              {user?.name?.[0] || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">{user?.name}</p>
              <p className="text-xs text-text-muted truncate">{user?.positionName}</p>
            </div>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-text-muted hover:text-text-primary">
              <LogOut size={16} />
            </button>
          </div>
          <p className="text-[10px] text-text-muted text-center mt-1">wjiad@aws · aws-samples</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
