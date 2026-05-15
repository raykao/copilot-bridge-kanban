import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { api, getErrorMessage, getToastErrorMessage } from '@/api/client';
import type { AgentTokenCreateResult, AgentTokenSummary } from '@/api/types';
import { ErrorState } from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const adminTokensQueryKey = ['adminTokens'] as const;

function formatTimestamp(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return '-';
  }

  return value.toLocaleString();
}

function buildBridgeConfigSnippet(agentName: string, token: string): string {
  return JSON.stringify(
    {
      bots: {
        [agentName]: {
          token: '<your-bridge-api-key>',
          agent: agentName,
          callback_token: token,
        },
      },
    },
    null,
    2,
  );
}

function SettingsPageSkeleton() {
  return (
    <div className="flex h-full min-w-0 flex-col gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  {Array.from({ length: 3 }).map((_, index) => (
                    <TableHead key={index}>
                      <Skeleton className="h-4 w-24" />
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 4 }).map((_, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {Array.from({ length: 3 }).map((_, cellIndex) => (
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
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-56" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-32" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TokenRevealDialog({
  result,
  onOpenChange,
}: {
  result: AgentTokenCreateResult | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [tokenCopied, setTokenCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const snippet = useMemo(
    () => (result ? buildBridgeConfigSnippet(result.agent_name, result.token) : ''),
    [result],
  );

  async function copyText(value: string, copied: 'token' | 'snippet') {
    try {
      await navigator.clipboard.writeText(value);
      if (copied === 'token') {
        setTokenCopied(true);
      } else {
        setSnippetCopied(true);
      }
    } catch {
      toast.error('Unable to copy to clipboard.');
    }
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      setTokenCopied(false);
      setSnippetCopied(false);
    }
    onOpenChange(open);
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={Boolean(result)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agent Token Generated</DialogTitle>
          <DialogDescription>Copy this token now. It will not be shown again.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="grid gap-4">
            <div className="grid gap-1">
              <span className="text-sm font-medium">Agent</span>
              <span className="text-sm text-muted-foreground">{result.agent_name}</span>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="agent-token-value">Token</Label>
              <Textarea
                className="w-full font-mono text-xs"
                id="agent-token-value"
                onClick={(event) => event.currentTarget.select()}
                readOnly
                rows={3}
                value={result.token}
              />
              <Button
                className="w-fit"
                onClick={() => {
                  void copyText(result.token, 'token');
                }}
                type="button"
                variant="outline"
              >
                {tokenCopied ? <Check /> : <Copy />}
                Copy to clipboard
              </Button>
            </div>

            <Separator />

            <div className="grid gap-2">
              <Label htmlFor="bridge-config-snippet">Bridge config JSON snippet</Label>
              <Textarea
                className="w-full font-mono text-xs"
                id="bridge-config-snippet"
                onClick={(event) => event.currentTarget.select()}
                readOnly
                rows={10}
                value={snippet}
              />
              <Button
                className="w-fit"
                onClick={() => {
                  void copyText(snippet, 'snippet');
                }}
                type="button"
                variant="outline"
              >
                {snippetCopied ? <Check /> : <Copy />}
                Copy snippet
              </Button>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={() => handleOpenChange(false)} type="button">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenRow({
  token,
  onRegenerate,
  onRevoke,
  regenerating,
  revoking,
}: {
  token: AgentTokenSummary;
  onRegenerate: (agentName: string) => void;
  onRevoke: (agentName: string) => void;
  regenerating: boolean;
  revoking: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <TableRow>
      <TableCell className="font-medium">{token.agent_name}</TableCell>
      <TableCell>{formatTimestamp(token.created_at)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={regenerating || revoking}
            onClick={() => onRegenerate(token.agent_name)}
            size="sm"
            type="button"
            variant="outline"
          >
            Regenerate
          </Button>
          <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
            <Button
              disabled={regenerating || revoking}
              onClick={() => setConfirmOpen(true)}
              size="sm"
              type="button"
              variant="destructive"
            >
              Revoke
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke agent token?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will revoke the token for {token.agent_name}. The agent must be updated with a new token before it can call back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={revoking}
                  onClick={() => {
                    setConfirmOpen(false);
                    onRevoke(token.agent_name);
                  }}
                  variant="destructive"
                >
                  Revoke
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [agentName, setAgentName] = useState('');
  const [revealedToken, setRevealedToken] = useState<AgentTokenCreateResult | null>(null);

  const tokensQuery = useQuery({
    queryKey: adminTokensQueryKey,
    queryFn: () => api.adminTokens.list(),
  });

  const createMutation = useMutation({
    mutationFn: (nextAgentName: string) => api.adminTokens.create(nextAgentName),
    onSuccess: async (result) => {
      setRevealedToken(result);
      setAgentName('');
      await queryClient.invalidateQueries({ queryKey: adminTokensQueryKey });
    },
    onError: (error) => {
      const message = getToastErrorMessage(error, 'Unable to generate token.');
      if (message) {
        toast.error(message, { id: message });
      }
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (nextAgentName: string) => api.adminTokens.revoke(nextAgentName),
    onSuccess: async () => {
      toast.success('Token revoked');
      await queryClient.invalidateQueries({ queryKey: adminTokensQueryKey });
    },
    onError: (error) => {
      const message = getToastErrorMessage(error, 'Unable to revoke token.');
      if (message) {
        toast.error(message, { id: message });
      }
    },
  });

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextAgentName = agentName.trim();
    if (!nextAgentName) {
      return;
    }

    createMutation.mutate(nextAgentName);
  }

  if (tokensQuery.isPending) {
    return <SettingsPageSkeleton />;
  }

  if (tokensQuery.isError) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <ErrorState
          message={getErrorMessage(tokensQuery.error, 'Failed to load agent tokens.')}
          onRetry={() => {
            void tokensQuery.refetch();
          }}
        />
      </div>
    );
  }

  const tokens = tokensQuery.data ?? [];

  return (
    <>
      <div className="flex h-full min-w-0 flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage bridge callback tokens for agents.</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <Card>
            <CardHeader>
              <CardTitle>Existing tokens</CardTitle>
              <CardDescription>Regenerate or revoke callback tokens for configured agents.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table className="min-w-[560px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent Name</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.length > 0 ? (
                    tokens.map((token) => (
                      <TokenRow
                        key={token.id}
                        onRegenerate={(nextAgentName) => createMutation.mutate(nextAgentName)}
                        onRevoke={(nextAgentName) => revokeMutation.mutate(nextAgentName)}
                        regenerating={createMutation.isPending}
                        revoking={revokeMutation.isPending}
                        token={token}
                      />
                    ))
                  ) : (
                    <TableRow>
                      <TableCell className="py-10 text-center text-muted-foreground" colSpan={3}>
                        No agent tokens configured yet.{' '}
                        <a className="text-primary underline-offset-4 hover:underline" href="#add-agent-form">
                          Add an agent token.
                        </a>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card id="add-agent-form">
            <CardHeader>
              <CardTitle>Add agent</CardTitle>
              <CardDescription>Generate a callback token for a bridge agent.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={handleSubmit}>
                <div className="grid gap-2">
                  <Label htmlFor="agent-name">Agent name</Label>
                  <Input
                    id="agent-name"
                    maxLength={64}
                    onChange={(event) => setAgentName(event.target.value)}
                    placeholder="agent-name"
                    required
                    value={agentName}
                  />
                </div>
                <Button disabled={createMutation.isPending} type="submit">
                  Generate Token
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <TokenRevealDialog
        onOpenChange={(open) => {
          if (!open) setRevealedToken(null);
        }}
        result={revealedToken}
      />
    </>
  );
}
