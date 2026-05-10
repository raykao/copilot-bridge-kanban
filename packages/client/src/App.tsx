import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthGuard } from './components/auth/AuthGuard';
import { LoginPage } from './components/auth/LoginPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function PlaceholderPage({ title }: { title: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="rounded-lg border border-border bg-card px-6 py-10 text-center text-card-foreground shadow-sm">
        {title}
      </div>
    </main>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<AuthGuard />}>
            <Route path="/board" element={<PlaceholderPage title="Board (coming soon)" />} />
            <Route path="/backlog" element={<PlaceholderPage title="Backlog (coming soon)" />} />
            <Route path="/cards/:id" element={<PlaceholderPage title="Card detail (coming soon)" />} />
            <Route path="/cards" element={<PlaceholderPage title="All cards (coming soon)" />} />
            <Route path="/chat/:agent" element={<PlaceholderPage title="Chat (coming soon)" />} />
          </Route>
          <Route path="*" element={<Navigate to="/board" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
