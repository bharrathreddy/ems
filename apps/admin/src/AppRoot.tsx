import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AuthProvider } from './lib/auth';
import App from './App';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } } });

export default function AppRoot() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/app">
        <AuthProvider>
          <App />
          <Toaster position="top-center" richColors closeButton />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
