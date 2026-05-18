import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { api, getErrorMessage } from '@/api/client';
import type {
  AdminProvider,
  AdminProviderDiscoveredAgent,
  AdminProviderRegistryStatus,
} from '@/api/types';
import { ErrorState } from '@/components/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const adminProvidersQueryKey = ['admin', 'providers'] as const;
const providerTypes = ['acp', 'copilot-bridge'] as const;
type ProviderType = (typeof providerTypes)[number];

interface ProviderFormState {
  label: string;
  type: ProviderType;
  url: string;
  apiKey: string;
}

const initialFormState: ProviderFormState = {
  label: '',
  type: 'acp',
  url: '',
  apiKey: '',
};

function formatProviderType(type: string): string {
  if (type === 'acp') return 'ACP';
  if (type === 'copilot-bridge') return 'Copilot Bridge';
  return type;
}

function SettingsPageSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {Array.from({ length: 6 }).map((_, index) => (
                  <TableHead key={index}>
                    <Skeleton className="h-4 w-24" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 4 }).map((_, rowIndex) => (
                <TableRow key={rowIndex}>
                  {Array.from({ length: 6 }).map((_, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status?: AdminProviderRegistryStatus }) {
  if (!status || status === 'discovering') {
    return <Badge variant="secondary">Connecting...</Badge>;
  }
  if (status === 'connected') {
    return <Badge variant="default" className="bg-green-600 hover:bg-green-600">Online</Badge>;
  }
  return <Badge variant="destructive">Offline</Badge>;
}

function AgentsList({ agents }: { agents: AdminProviderDiscoveredAgent[] }) {
  if (agents.length === 0) {
    return <span className="text-sm text-muted-foreground">No discovered agents.</span>;
  }

  return (
    <ul className="space-y-1 text-sm">
      {agents.map((agent) => (
        <li key={agent.id} className="flex items-center gap-2">
          <span className="font-medium">{agent.name}</span>
          {agent.description ? (
            <span className="text-muted-foreground">{agent.description}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ProviderRow({
  provider,
  deleting,
  onDelete,
  onRediscover,
  rediscovering,
}: {
  provider: AdminProvider;
  deleting: boolean;
  onDelete: (provider: AdminProvider) => void;
  onRediscover: (provider: AdminProvider) => void;
  rediscovering: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAgents = provider.agent_count > 0;
  const detailQuery = useQuery({
    queryKey: ['admin', 'providers', provider.id, 'detail'],
    queryFn: () => api.admin.providers.get(provider.id),
    enabled: expanded,
  });

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{provider.label}</TableCell>
        <TableCell>{formatProviderType(provider.type)}</TableCell>
        <TableCell className="max-w-md truncate" title={provider.url}>
          {provider.url}
        </TableCell>
        <TableCell>
          <StatusBadge status={provider.registry_status} />
        </TableCell>
        <TableCell>{provider.agent_count}</TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-2">
            {hasAgents ? (
              <Button
                aria-label={expanded ? 'Collapse agents' : 'Expand agents'}
                onClick={() => setExpanded((current) => !current)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            ) : null}
            <Button
              disabled={rediscovering}
              onClick={() => onRediscover(provider)}
              size="sm"
              type="button"
              variant="outline"
            >
              <RefreshCw />
              {rediscovering ? 'Re-discovering...' : 'Re-discover'}
            </Button>
            <Button
              disabled={deleting}
              onClick={() => onDelete(provider)}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && hasAgents ? (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 py-2 pl-8">
            {detailQuery.isPending ? (
              <span className="text-sm text-muted-foreground">Loading agents...</span>
            ) : detailQuery.isError ? (
              <span className="text-sm text-destructive">
                {getErrorMessage(detailQuery.error, 'Failed to load agents.')}
              </span>
            ) : (
              <AgentsList agents={detailQuery.data.agents} />
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function AddProviderForm({
  creating,
  onCancel,
  onCreate,
}: {
  creating: boolean;
  onCancel: () => void;
  onCreate: (form: ProviderFormState) => void;
}) {
  const [form, setForm] = useState<ProviderFormState>(initialFormState);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate(form);
  }

  return (
    <Card id="add-provider-form">
      <CardHeader>
        <CardTitle>Add Provider</CardTitle>
        <CardDescription>Register a new agent provider endpoint.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="provider-label">Label <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="provider-label"
                onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
                placeholder="Optional label"
                value={form.label}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider-type">Type *</Label>
              <Select
                onValueChange={(value) => {
                  if (value === 'acp' || value === 'copilot-bridge') {
                    setForm((current) => ({ ...current, type: value }));
                  }
                }}
                value={form.type}
              >
                <SelectTrigger className="w-full" id="provider-type">
                  <SelectValue placeholder="Select provider type" />
                </SelectTrigger>
                <SelectContent>
                  {providerTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {formatProviderType(type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="provider-url">URL *</Label>
              <Input
                id="provider-url"
                onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                placeholder="http://localhost:3000"
                required
                type="url"
                value={form.url}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider-api-key">API Key</Label>
              <Input
                id="provider-api-key"
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder="Optional"
                type="password"
                value={form.apiKey}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">* Required</p>

          <div className="flex flex-wrap gap-2">
            <Button disabled={creating} type="submit">
              {creating ? 'Adding...' : 'Add Provider'}
            </Button>
            <Button disabled={creating} onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);

  const providersQuery = useQuery({
    queryKey: adminProvidersQueryKey,
    queryFn: () => api.admin.providers.list(),
    refetchInterval: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: (form: ProviderFormState) => api.admin.providers.create({
      type: form.type,
      label: form.label.trim() || undefined,
      url: form.url.trim(),
      api_key: form.apiKey.trim() || undefined,
    }),
    onSuccess: async () => {
      toast.success('Provider added');
      setShowAddForm(false);
      await queryClient.invalidateQueries({ queryKey: adminProvidersQueryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.admin.providers.delete(id),
    onSuccess: async () => {
      toast.success('Provider deleted');
      await queryClient.invalidateQueries({ queryKey: adminProvidersQueryKey });
    },
  });

  const rediscoverMutation = useMutation({
    mutationFn: (id: string) => api.admin.providers.triggerDiscover(id),
    onSuccess: async () => {
      toast.success('Re-discovery triggered');
      await queryClient.invalidateQueries({ queryKey: adminProvidersQueryKey });
    },
  });

  function handleDelete(provider: AdminProvider) {
    if (window.confirm(`Delete provider ${provider.label}? This will remove all discovered agents under it.`)) {
      deleteMutation.mutate(provider.id);
    }
  }

  function handleRediscover(provider: AdminProvider) {
    rediscoverMutation.mutate(provider.id);
  }

  if (providersQuery.isPending) {
    return <SettingsPageSkeleton />;
  }

  if (providersQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(providersQuery.error, 'Failed to load agent providers.')}
          onRetry={() => {
            void providersQuery.refetch();
          }}
        />
      </div>
    );
  }

  const providers = providersQuery.data.providers;

  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage agent providers.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              View, add, and delete provider endpoints. Discovered agents appear under each provider.
            </CardDescription>
          </div>
          <Button
            className="min-h-11 w-full sm:w-auto"
            onClick={() => setShowAddForm((current) => !current)}
            type="button"
          >
            <Plus />
            Add Provider
          </Button>
        </CardHeader>
        <CardContent>
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Agents</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {providers.length > 0 ? (
                providers.map((provider) => (
                  <ProviderRow
                    deleting={deleteMutation.isPending}
                    key={provider.id}
                    onDelete={handleDelete}
                    onRediscover={handleRediscover}
                    provider={provider}
                    rediscovering={rediscoverMutation.isPending}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell className="py-10 text-center text-muted-foreground" colSpan={6}>
                    No agent providers configured yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {showAddForm ? (
        <AddProviderForm
          creating={createMutation.isPending}
          onCancel={() => setShowAddForm(false)}
          onCreate={(form) => createMutation.mutate(form)}
        />
      ) : null}
    </div>
  );
}
