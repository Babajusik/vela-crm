import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, onUnauthorized, setToken, getToken } from '../api.ts';
import type { Entity, Field, Option, PermLevel } from '../../core/types.ts';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: (n, e: any) => n < 1 && e?.status >= 500, refetchOnWindowFocus: false } },
});

// ---------------- auth ----------------
export interface Me {
  id: number; name: string; email: string; color?: string; position?: string; role_id: number | null;
  perms: Record<string, PermLevel>;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  settings: Record<string, any>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (module: string, level?: PermLevel) => boolean;
}

const AuthCtx = createContext<AuthState>(null as unknown as AuthState);
const LEVELS: PermLevel[] = ['none', 'read', 'write', 'admin'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return; }
    try {
      const r = await api.get('/api/auth/me');
      setUser(r.user);
      setSettings(r.settings ?? {});
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => onUnauthorized(() => { setToken(null); setUser(null); queryClient.clear(); }), []);

  const value = useMemo<AuthState>(() => ({
    user, loading, settings,
    login: async (email, password) => {
      const r = await api.post('/api/auth/login', { email, password });
      setToken(r.token);
      queryClient.clear();
      await refresh();
    },
    logout: async () => {
      try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
      setToken(null);
      setUser(null);
      queryClient.clear();
    },
    refresh,
    can: (module, level = 'read') => {
      if (!user) return false;
      if (module === 'dashboard' || module === 'notes') return true;
      const have = user.perms[module] ?? user.perms['*'] ?? 'none';
      return LEVELS.indexOf(have) >= LEVELS.indexOf(level);
    },
  }), [user, loading, settings, refresh]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

// ---------------- meta (schema) ----------------
export interface CustomField { id: number; entity: string; key: string; label: string; type: string; options: string[]; required: number }
interface Meta { entities: Entity[]; modules: Option[]; customFields: CustomField[]; settings: Record<string, any> }

export function useMeta() {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/api/meta'), enabled: !!user, staleTime: 60_000 });
  const byKey = useMemo(() => Object.fromEntries((q.data?.entities ?? []).map((e) => [e.key, e])), [q.data]);
  return {
    ready: !!q.data,
    meta: q.data,
    ent: (key: string): Entity | undefined => byKey[key],
    field: (key: string, f: string): Field | undefined => byKey[key]?.fields.find((x: Field) => x.key === f),
    custom: (key: string) => (q.data?.customFields ?? []).filter((c) => c.entity === key),
  };
}

// ---------------- data hooks ----------------
export type ListParams = Record<string, string | number | boolean | undefined | null>;

export function useList<T = any>(entity: string, params: ListParams = {}, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [entity, 'list', params],
    queryFn: () => api.get<{ items: T[]; total: number }>(`/api/e/${entity}`, params as any),
    enabled: opts.enabled ?? true,
    placeholderData: (prev) => prev,
  });
}

export function useRecord<T = any>(entity: string, id: number | string | undefined | null) {
  return useQuery({
    queryKey: [entity, 'one', String(id)],
    queryFn: () => api.get<T>(`/api/e/${entity}/${id}`),
    enabled: id !== undefined && id !== null && id !== '' && id !== 'new',
  });
}

export function useApi<T = any>(key: unknown[], path: string, params?: ListParams, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery({ queryKey: [...key, params], queryFn: () => api.get<T>(path, params as any), enabled: opts.enabled ?? true, refetchInterval: opts.refetchInterval });
}

/** Invalidate everything that depends on these entities (lists, records, dashboards) */
export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback((...entities: string[]) => {
    for (const e of entities) qc.invalidateQueries({ queryKey: [e] });
    for (const k of ['dashboard', 'finance', 'timeline', 'notifications', 'stats', 'calendar', 'bp', 'time', 'gantt', 'overview']) qc.invalidateQueries({ queryKey: [k] });
  }, [qc]);
}

export function useSave(entity: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, data }: { id?: number | null; data: Record<string, unknown> }) =>
      id ? api.patch(`/api/e/${entity}/${id}`, data) : api.post(`/api/e/${entity}`, data),
    onSuccess: () => inv(entity),
  });
}

export function useRemove(entity: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/e/${entity}/${id}`),
    onSuccess: () => inv(entity),
  });
}

// ---------------- users directory (cached) ----------------
export function useUsers() {
  const q = useList('users', { limit: 500, is_active: 1, expand: 0 });
  const items = q.data?.items ?? [];
  const byId = useMemo(() => new Map(items.map((u: any) => [u.id, u])), [items]);
  return { users: items as any[], byId };
}
