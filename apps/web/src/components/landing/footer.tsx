import Link from 'next/link';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border/40 py-10 sm:mt-24 sm:py-12">
      <div className="container">
        <div className="mb-10 grid grid-cols-1 gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div>
            <h4 className="font-semibold mb-3 text-sm">Product</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/register" className="hover:text-foreground">
                  Register
                </Link>
              </li>
              <li>
                <Link href="/registry" className="hover:text-foreground">
                  Registry
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-foreground">
                  Dashboard
                </Link>
              </li>
              <li>
                <Link href="/#pricing" className="hover:text-foreground">
                  Pricing
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-3 text-sm">Developers</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/docs" className="hover:text-foreground">
                  Documentation
                </Link>
              </li>
              <li>
                <Link href="/docs#stacks" className="hover:text-foreground">
                  TypeScript SDK
                </Link>
              </li>
              <li>
                <Link href="/docs#api" className="hover:text-foreground">
                  Agent API
                </Link>
              </li>
              <li>
                <Link href="https://github.com/0xmdrakib/AgentDomain" className="hover:text-foreground">
                  GitHub
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-3 text-sm">Resources</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/#features" className="hover:text-foreground">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/#how-it-works" className="hover:text-foreground">
                  How it works
                </Link>
              </li>
              <li>
                <Link href="/docs#api" className="hover:text-foreground">
                  API Flow
                </Link>
              </li>
              <li>
                <Link href="/docs#stacks" className="hover:text-foreground">
                  SDK Example
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-3 text-sm">Legal & Company</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <Link href="/" className="hover:text-foreground">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-foreground">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-foreground">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between border-t border-border/40 pt-8 text-center md:flex-row md:text-left">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-gradient-to-br from-blue-500 via-violet-500 to-fuchsia-500" />
            <span className="text-sm font-semibold">AgentDomain</span>
          </div>
          <p className="text-xs text-muted-foreground mt-4 md:mt-0">
            © {new Date().getFullYear()} AgentDomain. Built on Base.
          </p>
        </div>
      </div>
    </footer>
  );
}
