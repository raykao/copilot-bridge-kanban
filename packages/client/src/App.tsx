import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthGuard } from './components/auth/AuthGuard';
import { LoginPage } from './components/auth/LoginPage';
import { AppLayout } from './components/layout/AppLayout';
import { TooltipProvider } from './components/ui/tooltip';
import { BacklogPage } from './pages/BacklogPage';
import { BoardPage } from './pages/BoardPage';
import { CardListPage } from './pages/CardListPage';
import { CardPage } from './pages/CardPage';
import { ChatPage } from './pages/ChatPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

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
                <Route element={<CardListPage />} path="/cards" />
                <Route element={<ChatPage />} path="/chat/:agent" />
              </Route>
            </Route>
            <Route element={<Navigate replace to="/board" />} path="*" />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
