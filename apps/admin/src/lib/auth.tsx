import { forgetPushOnLogout } from './push';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, refreshAccessToken, session } from './api';
import { applyBrand } from './brand';

export interface TwoStep { twoStep: true; challengeId: string; sentTo: string; expiresInMinutes: number }
export type Workspace = 'staff' | 'parent' | 'student';
export interface Me {
  user: { id: string; name: string; email: string | null; mobile: string | null; isSuperAdmin: boolean };
  mustChangePassword: boolean;
  workspace: Workspace;
  workspaces: Workspace[];
  permissions: Record<string, string>;
  features: Record<string, boolean>;
  /** Set while the developer uses this person's login through "Login as". */
  proxy?: { by: string } | null;
}
export interface Branding { name: string; short_name: string | null; institution_type: 'school' | 'college'; brand_primary: string | null }

interface AuthState {
  status: 'loading' | 'anonymous' | 'ready';
  me: Me | null;
  branding: Branding | null;
  /** Signs in, or returns the emailed-code step for logins that use two-step sign-in. */
  login: (identifier: string, password: string) => Promise<TwoStep | void>;
  verifyCode: (challengeId: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  switchWorkspace: (w: Workspace) => Promise<void>;
  can: (permission: string) => boolean;
  startProxy: (userId: string) => Promise<void>;
  endProxy: () => Promise<void>;
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
    const { data } = await api<{ accessToken: string } | TwoStep>('/auth/login', { method: 'POST', body: { identifier, password } });
    if ('twoStep' in data) return data;
    session.setToken(data.accessToken);
    await reload();
  };
  const verifyCode = async (challengeId: string, code: string) => {
    const { data } = await api<{ accessToken: string }>('/auth/login/verify', { method: 'POST', body: { challengeId, code } });
    session.setToken(data.accessToken);
    await reload();
  };

  const startProxy = async (userId: string) => {
    const { data } = await api<{ accessToken: string; name: string }>('/auth/proxy', { method: 'POST', body: { userId } });
    session.setProxy(data.name);
    session.setToken(data.accessToken);
    qc.clear();
    await reload();
  };

  /** Back to the developer's own login (this tab). */
  const endProxy = async () => {
    await api('/auth/proxy/end', { method: 'POST' }).catch(() => undefined);
    session.setProxy(null);
    session.setToken(null);
    qc.clear();
    if (await refreshAccessToken()) await reload().catch(() => setStatus('anonymous'));
    else { setMe(null); setStatus('anonymous'); }
  };

  const logout = async () => {
    if (session.proxyName()) return endProxy();
    await forgetPushOnLogout();
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    session.setToken(null);
    session.setWorkspace(null);
    qc.clear();
    // After signing out, go to the school's website (it opens the sign-in page when the website is switched off).
    window.location.assign('/');
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

  return <Ctx.Provider value={{ status, me, branding, login, verifyCode, logout, reload, switchWorkspace, can, startProxy, endProxy }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
