import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

/** Unread alert count for the bell, refreshed every minute. */
export function useUnreadCount() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ['unread', me?.workspace],
    enabled: !!me && !me.mustChangePassword,
    refetchInterval: 60_000,
    queryFn: () => api<{ unread: number }>('/notifications/unread-count').then((r) => r.data.unread),
  });
}
