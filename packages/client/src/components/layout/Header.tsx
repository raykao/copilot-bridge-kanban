import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Menu, Monitor, Moon, Sun } from 'lucide-react';
import { useLocation, useParams } from 'react-router-dom';

import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ThemeMode } from '@/stores/theme';
import { useThemeStore } from '@/stores/theme';

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

const themeModeOrder: ThemeMode[] = ['light', 'dark', 'system'];

const themeLabelMap: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const themeIconMap = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} satisfies Record<ThemeMode, typeof Sun>;

export function Header({ onOpenMobileNav }: HeaderProps) {
  const { pathname } = useLocation();
  const { agent } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const mode = useThemeStore((state) => state.mode);
  const setTheme = useThemeStore((state) => state.setTheme);
  const title = getPageTitle(pathname, agent);
  const { data: preferences } = useQuery({
    queryKey: ['preferences'],
    queryFn: api.preferences.get,
    staleTime: 5 * 60 * 1000,
  });
  const saveThemeMutation = useMutation({
    mutationFn: (theme: ThemeMode) => api.preferences.update({ theme }),
    onSuccess: (updatedPreferences) => {
      queryClient.setQueryData(['preferences'], updatedPreferences);
    },
  });

  useEffect(() => {
    if (preferences?.theme && preferences.theme !== mode) {
      setTheme(preferences.theme);
    }
  }, [mode, preferences?.theme, setTheme]);

  const currentThemeIndex = themeModeOrder.indexOf(mode);
  const nextMode = themeModeOrder[(currentThemeIndex + 1) % themeModeOrder.length] ?? 'light';
  const ThemeIcon = themeIconMap[mode];

  const handleThemeToggle = () => {
    setTheme(nextMode);
    saveThemeMutation.mutate(nextMode);
  };

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
            render={<Button onClick={handleThemeToggle} size="icon" type="button" variant="ghost" />}
          >
            <ThemeIcon className="size-4" />
            <span className="sr-only">{`Theme: ${themeLabelMap[mode]}. Switch to ${themeLabelMap[nextMode]}.`}</span>
          </TooltipTrigger>
          <TooltipContent>{`Theme: ${themeLabelMap[mode]}. Click to switch to ${themeLabelMap[nextMode]}.`}</TooltipContent>
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
