import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled render error', error, errorInfo);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const showErrorDetails =
      typeof window !== 'undefined' &&
      ['127.0.0.1', 'localhost'].includes(window.location.hostname);

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <Card className="w-full max-w-lg shadow-sm">
          <CardHeader className="items-center text-center">
            <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="size-6" />
            </div>
            <CardTitle>Something went wrong</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              The page crashed while rendering. Reload to try again.
            </p>
            {showErrorDetails && this.state.error ? (
              <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 text-left text-xs text-muted-foreground">
                {this.state.error.message}
              </pre>
            ) : null}
            <Button onClick={() => window.location.reload()} type="button">
              Reload
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
}
