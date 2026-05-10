import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createHighlighter, type Highlighter } from "shiki";

import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

interface CodeBlockProps {
  className?: string;
  children?: React.ReactNode;
}

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [
        "typescript",
        "javascript",
        "python",
        "bash",
        "json",
        "yaml",
        "sql",
        "html",
        "css",
        "markdown",
        "dockerfile",
        "go",
        "rust",
      ],
    });
  }

  return highlighterPromise;
}

const supportedLanguages = new Set([
  "typescript",
  "javascript",
  "python",
  "bash",
  "json",
  "yaml",
  "sql",
  "html",
  "css",
  "markdown",
  "dockerfile",
  "go",
  "rust",
]);

function useIsDarkMode(): boolean {
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const root = document.documentElement;
    const updateTheme = () => {
      setIsDarkMode(root.classList.contains("dark"));
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
    };
  }, []);

  return isDarkMode;
}

function PlainCodeBlock({
  className,
  code,
}: {
  className?: string;
  code: string;
}) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-sm">
      <code className={cn("font-mono", className)}>{code}</code>
    </pre>
  );
}

function CodeBlock({ className, children }: CodeBlockProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const isDarkMode = useIsDarkMode();
  const match = /language-([\w-]+)/.exec(className ?? "");
  const language = match?.[1]?.toLowerCase();
  const code = String(children ?? "").replace(/\n$/, "");

  useEffect(() => {
    let cancelled = false;

    void getHighlighter().then((loadedHighlighter) => {
      if (!cancelled) {
        setHighlighter(loadedHighlighter);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const highlightedHtml = useMemo(() => {
    if (!highlighter || !language || !supportedLanguages.has(language)) {
      return null;
    }

    try {
      return highlighter.codeToHtml(code, {
        lang: language,
        theme: isDarkMode ? "github-dark" : "github-light",
      });
    } catch {
      return null;
    }
  }, [code, highlighter, isDarkMode, language]);

  if (!language || !highlightedHtml) {
    return <PlainCodeBlock className={className} code={code} />;
  }

  return (
    <div
      className="not-prose overflow-hidden rounded-lg border [&_pre]:overflow-x-auto [&_pre]:p-4"
      dangerouslySetInnerHTML={{ __html: highlightedHtml }}
    />
  );
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      className={cn(
        "prose prose-sm max-w-none break-words dark:prose-invert",
        className,
      )}
      components={{
        a({ className: linkClassName, ...props }) {
          return (
            <a
              className={cn(
                "text-primary underline underline-offset-4",
                linkClassName,
              )}
              {...props}
            />
          );
        },
        code({ className: codeClassName, children, ...props }) {
          const isBlock =
            typeof codeClassName === "string" &&
            codeClassName.startsWith("language-");

          if (isBlock) {
            return (
              <CodeBlock className={codeClassName} {...props}>
                {children}
              </CodeBlock>
            );
          }

          return (
            <code
              className={cn(
                "rounded bg-muted px-1 py-0.5 font-mono text-[0.875em]",
                codeClassName,
              )}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        table({ className: tableClassName, ...props }) {
          return (
            <table
              className={cn("w-full border-collapse text-sm", tableClassName)}
              {...props}
            />
          );
        },
        th({ className: cellClassName, ...props }) {
          return (
            <th
              className={cn(
                "border border-border px-3 py-2 text-left font-semibold",
                cellClassName,
              )}
              {...props}
            />
          );
        },
        td({ className: cellClassName, ...props }) {
          return (
            <td
              className={cn(
                "border border-border px-3 py-2 align-top",
                cellClassName,
              )}
              {...props}
            />
          );
        },
      }}
      remarkPlugins={[remarkGfm]}
    >
      {content}
    </ReactMarkdown>
  );
}
