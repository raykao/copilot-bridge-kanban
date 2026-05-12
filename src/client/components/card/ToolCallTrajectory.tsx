import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ToolCall } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ToolCallTrajectoryProps {
  toolCalls: ToolCall[];
}

function formatJson(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function statusTone(status: ToolCall["status"]): string {
  if (status === "completed") {
    return "bg-emerald-500";
  }

  if (status === "failed") {
    return "bg-destructive";
  }

  return "bg-amber-500";
}

function ToolCallItem({ toolCall }: { toolCall: ToolCall }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible
      className="rounded-lg border bg-background"
      onOpenChange={setOpen}
      open={open}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              statusTone(toolCall.status),
            )}
          />
          <div className="min-w-0">
            <p className="truncate font-semibold">{toolCall.name}</p>
            <p className="text-xs text-muted-foreground">{toolCall.status}</p>
          </div>
        </div>
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 border-t px-3 py-3">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Input
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{formatJson(toolCall.input)}</code>
          </pre>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Output
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
            <code>{formatJson(toolCall.error ?? toolCall.output)}</code>
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function ToolCallTrajectory({ toolCalls }: ToolCallTrajectoryProps) {
  if (toolCalls.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Tool calls</h3>
        <Badge variant="secondary">{toolCalls.length}</Badge>
      </div>
      <div className="space-y-2">
        {toolCalls.map((toolCall) => (
          <ToolCallItem key={toolCall.id} toolCall={toolCall} />
        ))}
      </div>
    </section>
  );
}
