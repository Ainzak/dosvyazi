import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useSession } from '../accounts/useSession';
import { VoiceClient } from './VoiceClient';
import { VoiceContext } from './VoiceContext';

export function VoiceProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new VoiceClient());
  const session = useSession();
  const id = session.data?.id;
  useEffect(() => { client.attach(id); return () => client.detach(); }, [client, id]);
  return <VoiceContext.Provider value={client}>{children}</VoiceContext.Provider>;
}
