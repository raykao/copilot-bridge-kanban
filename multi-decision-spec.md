# Multi-Decision Permission UI (Kanban)

## Goal
Redesign RunStatusBar's approval UI from a single Approve button to two split
buttons with dropdowns.

Layout in the awaiting status bar:
  [Approve once  chevron-down]     [Deny  chevron-down]

Clicking "Approve once" directly calls resume with 'allow-once'.
Clicking the chevron on the Approve side opens a dropdown with:
  - "Allow for session"  -> decision 'allow-session'
  - "Always allow"       -> decision 'allow-all'

Clicking "Deny" directly calls resume with 'deny'.
Clicking the chevron on the Deny side opens a dropdown with:
  - "Deny for session"  -> decision 'deny-session'
  - "Always deny"       -> decision 'deny-all'

## Repo and branch
/home/raykao/.copilot-bridge/workspaces/bob/workbench/copilot-bridge-kanban
Branch: feat/acp-refactor

---

### File 1: src/client/api/types.ts

Find ResumeDecision type and add the two new values:

export type ResumeDecision =
  | "allow-once"
  | "allow-session"
  | "allow-all-session"
  | "allow-all"
  | "deny"
  | "deny-session"
  | "deny-all";

---

### File 2: src/server/card-routes.ts

Find resumeDecisions Set and add the two new values:

const resumeDecisions = new Set([
  'allow-once',
  'allow-session',
  'allow-all-session',
  'allow-all',
  'deny',
  'deny-session',
  'deny-all',
]);

---

### File 3: src/client/components/RunStatusBar.tsx

Only modify the latestRun.status === 'awaiting' branch. Leave all other branches
(running, completed, failed, created) exactly as they are.

The new awaiting branch should look like this:

```
if (latestRun.status === 'awaiting') {
  const awaitingPermission = streaming.awaitingPermission;
  const awaitingRunId = awaitingPermission?.runId ?? latestRun.id;
  const toolName = awaitingPermission?.tool || 'Permission requested';

  const resume = async (decision: ResumeDecision) => {
    setIsResuming(true);
    try {
      await api.runs.resume(cardId, awaitingRunId, decision);
    } finally {
      setIsResuming(false);
    }
  };

  return (
    <div className={cn(barClassName, 'bg-amber-500/10 text-amber-900 dark:text-amber-200')}>
      <div className={statusClassName}>
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />
        <span className="truncate">Awaiting approval: {toolName}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Approve split button */}
        <div className="flex items-center">
          <Button
            disabled={isResuming}
            onClick={() => void resume('allow-once')}
            size="sm"
            type="button"
            className="rounded-r-none border-r-0"
          >
            {isResuming ? <Loader2 className="size-4 animate-spin" /> : null}
            Approve once
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isResuming}
                size="sm"
                type="button"
                className="rounded-l-none px-2"
                aria-label="More approve options"
              >
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void resume('allow-session')}>
                Allow for session
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void resume('allow-all')}>
                Always allow
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Deny split button */}
        <div className="flex items-center">
          <Button
            disabled={isResuming}
            onClick={() => void resume('deny')}
            size="sm"
            type="button"
            variant="outline"
            className="rounded-r-none border-r-0"
          >
            Deny
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={isResuming}
                size="sm"
                type="button"
                variant="outline"
                className="rounded-l-none px-2"
                aria-label="More deny options"
              >
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void resume('deny-session')}>
                Deny for session
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void resume('deny-all')}>
                Always deny
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ViewLiveButton onViewLive={onViewLive} runId={latestRun.id} />
      </div>
    </div>
  );
}
```

Imports to add at the top of RunStatusBar.tsx:
  import { ChevronDown } from 'lucide-react';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '@/components/ui/dropdown-menu';

Check the existing imports - do not duplicate any that are already there.

---

## Validation

cd /home/raykao/.copilot-bridge/workspaces/bob/workbench/copilot-bridge-kanban
npx tsc --noEmit 2>&1 | head -10
npm test -- --passWithNoTests 2>&1 | tail -20

---

## Commit

git add src/client/api/types.ts \
        src/server/card-routes.ts \
        src/client/components/RunStatusBar.tsx
git commit -m "feat: multi-decision approval UI with split buttons

Replaces single Approve/Deny buttons with split-button dropdowns:
- [Approve once v] dropdown: Allow for session | Always allow
- [Deny v] dropdown: Deny for session | Always deny

Adds deny-session and deny-all to ResumeDecision type and the
server-side resumeDecisions validation set.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

---

ESCALATION RULE: If any requirement in this spec is ambiguous, contradictory, or
covers a situation not described here, STOP. Report back: "The spec says X but I
encountered Y -- should I do A or B?" Wait for the answer.
