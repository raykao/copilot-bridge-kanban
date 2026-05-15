import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';

import { getToastErrorMessage } from './api/client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGuard } from './components/auth/AuthGuard';
import { CardEventsProvider } from './contexts/CardEventsContext';
import { LoginPage } from './components/auth/LoginPage';
import { AppLayout } from './components/layout/AppLayout';
import { Toaster } from './components/ui/sonner';
import { TooltipProvider } from './components/ui/tooltip';
import { BacklogPage } from './pages/BacklogPage';
import { BoardPage } from './pages/BoardPage';
import { CardListPage } from './pages/CardListPage';
import { CardPage } from './pages/CardPage';
import { ChatPage } from './pages/ChatPage';
import { SettingsPage } from './pages/SettingsPage';

function showApiErrorToast(error: unknown) {
  const message = getToastErrorMessage(error);
  if (message) {
    toast.error(message, { id: message });
  }
}

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: showApiErrorToast,
  }),
  queryCache: new QueryCache({
    onError: showApiErrorToast,
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
              <Route element={<LoginPage />} path="/login" />
              <Route element={<AuthGuard />}>
                <Route
                  element={
                    <CardEventsProvider>
                      <AppLayout />
                    </CardEventsProvider>
                  }
                >
                  <Route element={<BoardPage />} path="/board" />
                  <Route element={<BacklogPage />} path="/backlog" />
                  <Route element={<CardPage />} path="/cards/:id" />
                  <Route element={<CardListPage />} path="/cards" />
                  <Route element={<ChatPage />} path="/chat/:agent" />
                  <Route element={<SettingsPage />} path="/settings" />
                </Route>
              </Route>
              <Route element={<Navigate replace to="/board" />} path="*" />
            </Routes>
          </ErrorBoundary>
          <Toaster richColors />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
