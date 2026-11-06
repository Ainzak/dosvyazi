import { createContext, useContext } from 'react';
import type { DirectCall } from '../../api/directCalls';

export const DirectCallContext = createContext<{
  calls: DirectCall[]; error: string | null; busy: boolean; user: string | undefined;
  start: (conversation: string) => void; answer: (call: DirectCall) => void; end: (call: DirectCall) => void; join: (call: DirectCall) => void;
} | null>(null);
export function useDirectCalls() {
  const value = useContext(DirectCallContext); if (!value) throw new Error('Direct call provider is missing.'); return value;
}
