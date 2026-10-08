import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../accounts/useSession';

export function PrivateCacheBoundary() {
  const client = useQueryClient();
  const user = useSession().data?.id;
  useEffect(() => {
    const predicate = (query: { queryKey: readonly unknown[] }) => query.queryKey[0] === 'private' && query.queryKey[1] !== user;
    void client.cancelQueries({ predicate });
    client.removeQueries({ predicate });
  }, [client, user]);
  return null;
}
