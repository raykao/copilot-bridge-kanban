import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { api, getErrorMessage } from '@/api/client';
import type { AdminAgent, ProviderConnectionStatus, ProviderStatusEntry } from '@/api/types';
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

const adminAgentsQueryKey = ['admin', 'agents'] as const;
const providerStatusQueryKey = ['agents', 'provider-status'] as const;
const providerTypes = ['generic-acp', 'copilot-bridge'] as const;
type ProviderType = (typeof providerTypes)[number];

interface ProviderFormState {
  name: string;
  protocol: ProviderType;
  url: string;
  apiKey: string;
  autoApprove: boolean;
}

const initialFormState: ProviderFormState = {
  name: '',
  protocol: 'generic-acp',
  url: '',
  apiKey: '',
  autoApprove: false,
};

function formatProviderType(protocol: string): string {
  if (protocol === 'generic-acp') return 'Generic ACP';
  if (protocol === 'copilot-bridge') return 'Copilot Bridge';
  if (protocol === 'acp') return 'ACP';
  return protocol;
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
                {Array.from({ length: 5 }).map((_, index) => (
                  <TableHead key={index}>
                    <Skeleton className="h-4 w-24" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 4 }).map((_, rowIndex) => (
                <TableRow key={rowIndex}>
                  {Array.from({ length: 5 }).map((_, cellIndex) => (
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

function StatusBadge({ status }: { status?: ProviderConnectionStatus }) {
  if (!status || status === 'discovering') {
    return <Badge variant="secondary">Connecting...</Badge>;
  }
  if (status === 'connected') {
    return <Badge variant="default" className="bg-green-600 hover:bg-green-600">Online</Badge>;
  }
  return <Badge variant="destructive">Offline</Badge>;
}

function ProviderRow({
  agent,
  deleting,
  onDelete,
  statusEntry,
}: {
  agent: AdminAgent;
  deleting: boolean;
  onDelete: (agent: AdminAgent) => void;
  statusEntry?: ProviderStatusEntry;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasAgents = (statusEntry?.agents.length ?? 0) > 0;

  return (
    <>
      <TableRow>
        <TableCell className="font-medium">{agent.name ?? agent.url}</TableCell>
        <TableCell>{formatProviderType(agent.protocol)}</TableCell>
        <TableCell className="max-w-md truncate" title={agent.url}>
          {agent.url}
        </TableCell>
        <TableCell>
          <StatusBadge status={statusEntry?.status} />
        </TableCell>
        <TableCell>{agent.auto_approve ? 'Yes' : 'No'}</TableCell>
        <TableCell>
          <div className="flex gap-2">
            {hasAgents && (
              <Button
                onClick={() => setExpanded((e) => !e)}
                size="sm"
                type="button"
                variant="ghost"
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            )}
            <Button
              disabled={deleting}
              onClick={() => onDelete(agent)}
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
      {expanded && hasAgents && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30 py-2 pl-8">
            <ul className="space-y-1 text-sm">
              {statusEntry!.agents.map((a) => (
                <li key={a.name} className="flex items-center gap-2">
                  <span className="font-medium">{a.name}</span>
                  {a.description && (
                    <span className="text-muted-foreground">{a.description}</span>
                  )}
                </li>
              ))}
            </ul>
          </TableCell>
        </TableRow>
      )}
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
              <Label htmlFor="provider-name">Label <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                id="provider-name"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Optional label"
                value={form.name}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="provider-protocol">Type *</Label>
              <Select
                onValueChange={(value) => {
                  if (value === 'generic-acp' || value === 'copilot-bridge') {
                    setForm((current) => ({ ...current, protocol: value }));
                  }
                }}
                value={form.protocol}
              >
                <SelectTrigger className="w-full" id="provider-protocol">
                  <SelectValue placeholder="Select provider type" />
                </SelectTrigger>
                <SelectContent>
                  {providerTypes.map((protocol) => (
                    <SelectItem key={protocol} value={protocol}>
                      {formatProviderType(protocol)}
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

          <Label className="w-fit">
            <input
              checked={form.autoApprove}
              className="size-4 rounded border-input accent-primary"
              onChange={(event) => setForm((current) => ({ ...current, autoApprove: event.target.checked }))}
              type="checkbox"
            />
            Auto-approve
          </Label>

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

  const agentsQuery = useQuery({
    queryKey: adminAgentsQueryKey,
    queryFn: () => api.admin.agents.list(),
  });

  const statusQuery = useQuery({
    queryKey: providerStatusQueryKey,
    queryFn: () => api.agents.providerStatus(),
    refetchInterval: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (form: ProviderFormState) => {
      const apiKey = form.apiKey.trim();

      return api.admin.agents.create({
        name: form.name.trim(),
        protocol: form.protocol,
        url: form.url.trim(),
        api_key: apiKey || undefined,
        auto_approve: form.autoApprove,
      });
    },
    onSuccess: async () => {
      toast.success('Provider added');
      setShowAddForm(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAgentsQueryKey }),
        queryClient.invalidateQueries({ queryKey: providerStatusQueryKey }),
      ]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.admin.agents.delete(id),
    onSuccess: async () => {
      toast.success('Provider deleted');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: adminAgentsQueryKey }),
        queryClient.invalidateQueries({ queryKey: providerStatusQueryKey }),
      ]);
    },
  });

  function handleDelete(agent: AdminAgent) {
    if (window.confirm(`Delete agent ${agent.name ?? agent.url}?`)) {
      deleteMutation.mutate(agent.id);
    }
  }

  if (agentsQuery.isPending) {
    return <SettingsPageSkeleton />;
  }

  if (agentsQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(agentsQuery.error, 'Failed to load agent providers.')}
          onRetry={() => {
            void agentsQuery.refetch();
          }}
        />
      </div>
    );
  }

  const agents = agentsQuery.data.agents;

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
            <CardTitle>Agent Providers</CardTitle>
            <CardDescription>View, add, and delete provider endpoints.</CardDescription>
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
                <TableHead>Auto-approve</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.length > 0 ? (
                agents.map((agent) => (
                  <ProviderRow
                    agent={agent}
                    deleting={deleteMutation.isPending}
                    key={agent.id}
                    onDelete={handleDelete}
                    statusEntry={statusQuery.data?.providers.find((p) => p.id === agent.id)}
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
