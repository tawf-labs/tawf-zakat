import Link from 'next/link';
import { Home } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="flex-1 py-8 lg:py-12 bg-background">
      <div className="container px-4 mx-auto max-w-7xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground mb-6">
          <Home className="h-4 w-4" />
          Back to Home
        </Link>
        <div className="flex flex-col items-center justify-center py-24">
          <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
          <h2 className="text-2xl font-semibold mb-2">Page Not Found</h2>
          <p className="text-muted-foreground mb-8">The page you're looking for doesn't exist.</p>
          <Link href="/" className="px-6 py-3 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">
            Go to Homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
