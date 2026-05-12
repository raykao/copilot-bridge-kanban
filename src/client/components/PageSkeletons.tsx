import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function HeaderSkeleton() {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-10 w-28 rounded-md" />
    </div>
  );
}

function BoardColumnSkeleton() {
  return (
    <div className="flex h-full w-72 shrink-0 flex-col rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-6 w-8 rounded-full" />
        </div>
      </div>
      <div className="space-y-3 p-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className="space-y-3 rounded-xl border p-3 shadow-sm" key={index}>
            <div className="flex items-start justify-between gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BoardPageSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div className="flex h-full flex-col gap-4">
      <HeaderSkeleton />
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2">
        {Array.from({ length: columns }).map((_, index) => (
          <BoardColumnSkeleton key={index} />
        ))}
      </div>
    </div>
  );
}

export function CardPageSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <Card className="min-h-[calc(100vh-10rem)]">
        <CardHeader className="gap-4 border-b">
          <div className="space-y-3">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-48" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6 py-4">
          <div className="space-y-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-36" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="space-y-2 rounded-xl border p-4" key={index}>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-4">
        <CardHeader>
          <Skeleton className="h-7 w-20" />
        </CardHeader>
        <CardContent className="space-y-6 pb-4">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="space-y-2" key={index}>
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          ))}
          <div className="space-y-2">
            <Skeleton className="h-4 w-16" />
            <div className="grid gap-2">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function CardListPageSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: 7 }).map((_, index) => (
                <TableHead key={index}>
                  <Skeleton className="h-4 w-20" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, rowIndex) => (
              <TableRow key={rowIndex}>
                {Array.from({ length: 7 }).map((_, cellIndex) => (
                  <TableCell key={cellIndex}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MessageBubbleSkeleton({ align }: { align: 'left' | 'right' }) {
  return (
    <div className={`flex ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
      <div className="w-full max-w-[75%] space-y-2 rounded-2xl border bg-muted/20 p-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  );
}

export function ChatPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>

        <div className="flex-1 space-y-4 px-4 py-4">
          <MessageBubbleSkeleton align="left" />
          <MessageBubbleSkeleton align="right" />
          <MessageBubbleSkeleton align="left" />
          <MessageBubbleSkeleton align="right" />
        </div>

        <div className="border-t px-4 py-4">
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
