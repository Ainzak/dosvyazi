import { useEffect, useState } from 'react';
import { HubConnectionBuilder, HttpTransportType, LogLevel } from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';
import { gatheringKeys } from '../../api/gatherings';

export function useGatheringLive(user: string, community: string, enabled = true) {
  const client = useQueryClient(); const [status, setStatus] = useState('Connecting…'); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const connection = new HubConnectionBuilder().withUrl('/hubs/gatherings', { transport: HttpTransportType.WebSockets, skipNegotiation: true })
      .withAutomaticReconnect([0, 1000, 5000, 10000]).configureLogging(LogLevel.None).build();
    const refresh = () => { if (!disposed) void client.cancelQueries({ queryKey: gatheringKeys(user, community) }).then(() => client.invalidateQueries({ queryKey: gatheringKeys(user, community) })); };
    const subscribe = async () => { await connection.invoke('Subscribe', community); if (!disposed) { setStatus('Live'); refresh(); } };
    const start = async () => {
      if (disposed || !navigator.onLine) { if (!disposed) setStatus('Offline.'); return; }
      try { await connection.start(); if (disposed) { await connection.stop(); return; } await subscribe(); }
      catch { await connection.stop(); if (!disposed) { setStatus('Reconnecting…'); refresh(); timer = setTimeout(() => void start(), 5000); } }
    };
    connection.on('GatheringsRefresh', refresh);
    connection.onreconnecting(() => { if (!disposed) setStatus('Reconnecting…'); });
    connection.onreconnected(() => void subscribe().catch(refresh));
    connection.onclose(() => { if (!disposed) { setStatus(navigator.onLine ? 'Live updates unavailable.' : 'Offline.'); refresh(); } });
    const offline = () => { clearTimeout(timer); setStatus('Offline.'); void connection.stop(); };
    const online = () => { clearTimeout(timer); void start(); };
    window.addEventListener('offline', offline); window.addEventListener('online', online); void start();
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', online); void connection.stop(); };
  }, [user, community, enabled, client, attempt]);
  return { status, reconnect: () => setAttempt(value => value + 1) };
}
