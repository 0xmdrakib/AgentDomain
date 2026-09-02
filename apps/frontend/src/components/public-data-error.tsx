'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { PublicNav } from '@/components/landing/public-nav';
import { Footer } from '@/components/landing/footer';
import { Button } from '@/components/ui/button';

export function PublicDataError({
  title,
  description,
  error,
  reset,
}: {
  title: string;
  description: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-background">
      <PublicNav />
      <section
        className="container flex min-h-[60vh] max-w-3xl flex-col justify-center py-16"
        role="alert"
      >
        <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle aria-hidden="true" className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-xl text-muted-foreground">{description}</p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/">Go home</Link>
          </Button>
        </div>
      </section>
      <Footer />
    </main>
  );
}
