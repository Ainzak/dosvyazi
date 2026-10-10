import { createContext, useContext } from 'react';
import type { VoiceClient } from './VoiceClient';
export const VoiceContext = createContext<VoiceClient | null>(null);
export function useVoiceClient() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error('Voice provider is missing.');
  return value;
}
