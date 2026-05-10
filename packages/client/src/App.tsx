import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthGuard } from './components/auth/AuthGuard';
import { LoginPage } from './components/auth/LoginPage';
import { AppLayout } from './components/layout/AppLayout';
import { TooltipProvider } from './components/ui/tooltip';
import { BacklogPage } from './pages/BacklogPage';
import { BoardPage } from './pages/BoardPage';
import { CardPage } from './pages/CardPage';

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
            <Route element={<LoginPage />} path="/login" />
            <Route element={<AuthGuard />}>
              <Route element={<AppLayout />}>
                <Route element={<BoardPage />} path="/board" />
                <Route element={<BacklogPage />} path="/backlog" />
                <Route element={<CardPage />} path="/cards/:id" />
                <Route element={<PlaceholderPage title="All cards (coming soon)" />} path="/cards" />
                <Route element={<PlaceholderPage title="Chat (coming soon)" />} path="/chat/:agent" />
              </Route>
            </Route>
            <Route element={<Navigate replace to="/board" />} path="*" />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
