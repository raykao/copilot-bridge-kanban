import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Inbox, LayoutDashboard, List, LogOut, MessageSquare, type LucideIcon } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const primaryNav = [
  { label: 'Board', href: '/board', icon: LayoutDashboard },
  { label: 'Backlog', href: '/backlog', icon: Inbox },
  { label: 'All Cards', href: '/cards', icon: List },
] as const;

interface SidebarProps {
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

function isPathActive(pathname: string, href: string): boolean {
  if (href === '/cards') {
    return pathname === '/cards' || pathname.startsWith('/cards/');
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavItem({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-sidebar-primary text-sidebar-primary-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      )}
      onClick={onNavigate}
      to={href}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </Link>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { data: agents, isLoading, isError } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
    staleTime: 60_000,
  });

  const sortedAgents = useMemo(
    () => (agents ? [...agents].sort((a, b) => a.name.localeCompare(b.name)) : []),
    [agents],
  );

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-4 py-5">
        <Link className="flex items-center gap-3 font-semibold tracking-tight" onClick={onNavigate} to="/board">
          <div className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Bot className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Workspace</p>
            <p className="truncate text-base">copilot-bridge</p>
          </div>
        </Link>
      </div>

      <Separator />

      <div className="space-y-1 px-3 py-4">
        {primaryNav.map((item) => (
          <NavItem
            active={isPathActive(location.pathname, item.href)}
            href={item.href}
            icon={item.icon}
            key={item.href}
            label={item.label}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <Separator />

      <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
        <div className="px-3 pb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Chat
        </div>
        <ScrollArea className="min-h-0 flex-1 pr-2">
          <div className="space-y-1 pb-2">
            {isLoading ? (
              <div className="space-y-2 px-3 py-2 text-sm text-muted-foreground">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              </div>
            ) : null}

            {isError ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Unable to load agents.</p>
            ) : null}

            {!isLoading && !isError && sortedAgents.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">No agents found.</p>
            ) : null}

            {sortedAgents.map((agent) => {
              const href = `/chat/${encodeURIComponent(agent.name)}`;

              return (
                <NavItem
                  active={location.pathname === href}
                  href={href}
                  icon={MessageSquare}
                  key={agent.name}
                  label={agent.name}
                  onNavigate={onNavigate}
                />
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      <div className="p-3">
        <Tooltip>
          <TooltipTrigger
            className="w-full"
            render={<Button className="w-full justify-start gap-3" variant="ghost" />}
            type="button"
            onClick={() => {
              void handleLogout();
            }}
          >
            <LogOut className="size-4" />
            <span>Logout</span>
          </TooltipTrigger>
          <TooltipContent side="right">Sign out</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function Sidebar({ mobileOpen, onMobileOpenChange }: SidebarProps) {
  return (
    <>
      <aside className="hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar md:flex">
        <SidebarContent />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent className="w-80 p-0" showCloseButton={false} side="left">
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation menu</SheetTitle>
            <SheetDescription>Browse the board and switch between agents.</SheetDescription>
          </SheetHeader>
          <SidebarContent onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
