import { useQuery } from '@tanstack/react-query';
import { getProfile, sessionKey } from '../../api/accounts';

export function useSession() {
  return useQuery({ queryKey: sessionKey, queryFn: ({ signal }) => getProfile(signal) });
}
