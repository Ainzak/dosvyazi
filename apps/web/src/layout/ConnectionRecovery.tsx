import { createContext, useContext } from 'react';
import { ApiError } from '../api/http';

export const ConnectionRecovery = createContext(false);
export const useSharedRecovery = () => useContext(ConnectionRecovery);
export const connectionFailure = (error: unknown) => error instanceof ApiError && [0, 502, 503, 504].includes(error.status);
