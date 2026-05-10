import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      className={cn('prose prose-sm max-w-none break-words dark:prose-invert', className)}
      components={{
        a({ className: linkClassName, ...props }) {
          return <a className={cn('text-primary underline underline-offset-4', linkClassName)} {...props} />;
        },
        code({ className: codeClassName, children, ...props }) {
          const isBlock = typeof codeClassName === 'string' && codeClassName.includes('language-');

          if (isBlock) {
            return (
              <code className={cn('bg-transparent p-0 text-sm text-inherit', codeClassName)} {...props}>
                {children}
              </code>
            );
          }

          return (
            <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]', codeClassName)} {...props}>
              {children}
            </code>
          );
        },
        pre({ className: preClassName, ...props }) {
          return (
            <pre
              className={cn('overflow-x-auto rounded-lg bg-slate-950 p-4 text-slate-50 dark:bg-slate-900', preClassName)}
              {...props}
            />
          );
        },
        table({ className: tableClassName, ...props }) {
          return <table className={cn('w-full border-collapse text-sm', tableClassName)} {...props} />;
        },
        th({ className: cellClassName, ...props }) {
          return <th className={cn('border border-border px-3 py-2 text-left font-semibold', cellClassName)} {...props} />;
        },
        td({ className: cellClassName, ...props }) {
          return <td className={cn('border border-border px-3 py-2 align-top', cellClassName)} {...props} />;
        },
      }}
      remarkPlugins={[remarkGfm]}
    >
      {content}
    </ReactMarkdown>
  );
}
