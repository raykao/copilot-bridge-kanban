import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';

import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/sse/system');
    // On connect, invalidate immediately to catch events that fired before we subscribed
    es.onopen = () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    };
    es.addEventListener('provider.status_changed', () => {
      // Invalidate ['agents'] and all sub-keys (e.g. ['agents', 'provider-status'])
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    });
    es.onerror = () => { /* reconnects automatically */ };
    return () => { es.close(); };
  }, [queryClient]);

  return (
    <div className="flex h-screen bg-muted/20">
      <Sidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onOpenMobileNav={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
