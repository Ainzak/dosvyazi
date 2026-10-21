import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { registerDeliveryWorker } from './features/delivery/registerWorker';
import { ApiError } from './api/http';
import { LanguageProvider } from './i18n/LanguageProvider';
import './styles.css';
import './layout/workspace.css';
import './layout/conversations.css';
import './layout/voice.css';
import './layout/gatherings.css';
import './layout/management.css';
import './layout/threads.css';
import './layout/forums.css';

const queryClient = new QueryClient({ defaultOptions: { queries: {
  // Retry only reads interrupted by transient transport/service failures.
  // Authentication/access failures and mutations never use this policy.
  retry: (attempt, error) => attempt < 2 && error instanceof ApiError && [0, 502, 503, 504].includes(error.status),
  retryDelay: attempt => Math.min(1000 * 2 ** attempt, 3000), refetchInterval: 15_000, refetchOnWindowFocus: true,
} } });

registerDeliveryWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LanguageProvider><BrowserRouter><App /></BrowserRouter></LanguageProvider>
    </QueryClientProvider>
  </StrictMode>,
);
