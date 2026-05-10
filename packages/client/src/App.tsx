import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthGuard } from './components/auth/AuthGuard';
import { LoginPage } from './components/auth/LoginPage';
import { AppLayout } from './components/layout/AppLayout';
import { TooltipProvider } from './components/ui/tooltip';
import { BacklogPage } from './pages/BacklogPage';
import { BoardPage } from './pages/BoardPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex min-h-full items-center justify-center rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center text-card-foreground shadow-sm">
      {title}
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<AuthGuard />}>
              <Route element={<AppLayout />}>
                <Route path="/board" element={<BoardPage />} />
                <Route path="/backlog" element={<BacklogPage />} />
                <Route path="/cards/:id" element={<PlaceholderPage title="Card detail (coming soon)" />} />
                <Route path="/cards" element={<PlaceholderPage title="All cards (coming soon)" />} />
                <Route path="/chat/:agent" element={<PlaceholderPage title="Chat (coming soon)" />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/board" replace />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
