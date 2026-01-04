import { useEffect, useRef } from 'react';
import type { User } from './types';

type WebSocketMessage = {
  type?: string;
  threadId?: string;
  threadType?: 'CHANNEL' | 'DM';
  message?: any;
  reaction?: { messageId: string; emoji: string; userId: string; action: 'add' | 'remove' };
  typing?: { threadId: string; userId: string; userName: string; action: 'start' | 'stop' };
  edited?: { messageId: string; body: string };
  deleted?: { messageId: string };
  pinned?: { threadId: string; message: any };
  unpinned?: { threadId: string; messageId: string };
};

type UseWebSocketProps = {
  token: string | null;
  apiBase: string;
  user: User | null;
  activeThreadId: string;
  onMessage: (payload: WebSocketMessage) => void;
};

export function useWebSocket({ token, apiBase, user, activeThreadId, onMessage }: UseWebSocketProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const activeThreadRef = useRef<string>('');
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeThreadRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      const base = apiBase.startsWith('http') ? apiBase : window.location.origin;
      const wsUrl = new URL('/ws/community', base);
      wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      wsUrl.searchParams.set('token', token);
      const socket = new WebSocket(wsUrl.toString());
      wsRef.current = socket;

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as WebSocketMessage;
          onMessage(payload);
        } catch (err) {
          console.error('Failed to parse realtime message', err);
        }
      };

      socket.onclose = () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        if (!cancelled) {
          reconnectTimerRef.current = setTimeout(connect, 2500);
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [token, apiBase, onMessage]);

  return { wsRef, activeThreadRef };
}
