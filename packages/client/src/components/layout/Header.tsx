import { Menu, SunMoon } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface HeaderProps {
  onOpenMobileNav: () => void;
}

function getPageTitle(pathname: string, agentName?: string): string {
  if (pathname.startsWith('/chat/')) {
    return agentName ? `Chat: ${agentName}` : 'Chat';
  }

  if (pathname.startsWith('/cards/')) {
    return 'Card detail';
  }

  if (pathname === '/cards') {
    return 'All Cards';
  }

  if (pathname === '/backlog') {
    return 'Backlog';
  }

  return 'Board';
}

function getInitials(username?: string): string {
  return username ? username.slice(0, 2).toUpperCase() : '??';
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  const { pathname } = useLocation();
  const { agent } = useParams();
  const { user } = useAuth();
  const title = getPageTitle(pathname, agent);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="flex min-w-0 items-center gap-3">
        <Button className="md:hidden" onClick={onOpenMobileNav} size="icon" type="button" variant="ghost">
          <Menu className="size-5" />
          <span className="sr-only">Open navigation menu</span>
        </Button>
        <Separator className="hidden h-6 md:block" orientation="vertical" />
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold">{title}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger
            render={<Button size="icon" type="button" variant="ghost" />}
          >
            <SunMoon className="size-4" />
            <span className="sr-only">Toggle theme</span>
          </TooltipTrigger>
          <TooltipContent>Theme toggle coming soon</TooltipContent>
        </Tooltip>

        <div className="flex items-center gap-3 rounded-full border bg-card px-2 py-1.5 text-sm shadow-sm">
          <Avatar size="sm">
            <AvatarFallback>{getInitials(user?.username)}</AvatarFallback>
          </Avatar>
          <span className="hidden font-medium sm:inline">{user?.username ?? 'Unknown user'}</span>
        </div>
      </div>
    </header>
  );
}
