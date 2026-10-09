import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken, session } from './api';
import { applyBrand } from './brand';

export type Workspace = 'staff' | 'parent' | 'student';
export interface Me {
  user: { id: string; name: string; email: string | null; mobile: string | null; isSuperAdmin: boolean };
  mustChangePassword: boolean;
  workspace: Workspace;
  workspaces: Workspace[];
  permissions: Record<string, string>;
  features: Record<string, boolean>;
}
export interface Branding { name: string; short_name: string | null; institution_type: 'school' | 'college'; brand_primary: string | null }

interface AuthState {
  status: 'loading' | 'anonymous' | 'ready';
  me: Me | null;
  branding: Branding | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  switchWorkspace: (w: Workspace) => Promise<void>;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [branding, setBranding] = useState<Branding | null>(null);

  const reload = useCallback(async () => {
    const { data } = await api<Me>('/auth/me');
    setMe(data);
    session.setWorkspace(data.workspace);
    setStatus('ready');
  }, []);

  useEffect(() => {
    api<Branding>('/public/branding').then(({ data }) => { setBranding(data); applyBrand(data?.brand_primary); }).catch(() => undefined);
    refreshAccessToken().then((ok) => (ok ? reload().catch(() => setStatus('anonymous')) : setStatus('anonymous')));
  }, [reload]);

  const login = async (identifier: string, password: string) => {
    const { data } = await api<{ accessToken: string }>('/auth/login', { method: 'POST', body: { identifier, password } });
    session.setToken(data.accessToken);
    await reload();
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    session.setToken(null);
    session.setWorkspace(null);
    qc.clear();
    setMe(null);
    setStatus('anonymous');
  };

  const switchWorkspace = async (w: Workspace) => {
    session.setWorkspace(w);
    qc.clear();
    await reload();
  };

  const can = (p: string) => {
    if (!me) return false;
    const module = p.split('.')[0];
    if (module in me.features && !me.features[module]) return false;
    return p in me.permissions;
  };

  return <Ctx.Provider value={{ status, me, branding, login, logout, reload, switchWorkspace, can }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
