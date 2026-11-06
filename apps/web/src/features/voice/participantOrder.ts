import type { VoiceState } from '../../api/voice';

// SFU enumeration order is not a presentation order. Never move a row just for speaking/muting.
export function orderedVoiceMembers(members: VoiceState['participants']) {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return [...members].sort((a, b) => compare(a.displayName.normalize('NFKC').toLowerCase(), b.displayName.normalize('NFKC').toLowerCase()) || compare(a.identity, b.identity));
}
