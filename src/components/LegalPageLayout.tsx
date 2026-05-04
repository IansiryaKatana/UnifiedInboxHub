import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

type LegalPageLayoutProps = {
  title: string;
  children: ReactNode;
};

export function LegalPageLayout({ title, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-white text-neutral-950 antialiased font-sans flex flex-col">
      <header className="border-b border-neutral-200 shrink-0 px-4 py-4 sm:px-8 lg:px-12">
        <div className="relative mx-auto flex min-h-10 w-full max-w-3xl items-center justify-between gap-2 sm:gap-3">
          <Link to="/" className="relative z-10 shrink-0" aria-label="Unified Inbox Hub">
            <img
              src="/favicon-32.png"
              alt=""
              width={32}
              height={32}
              decoding="async"
              className="size-8 rounded-md object-contain sm:hidden"
            />
            <img
              src="/logo dark.png"
              alt=""
              className="hidden h-8 w-auto max-h-9 max-w-[min(100%,220px)] object-contain object-left sm:block sm:h-9"
              width={220}
              height={36}
              decoding="async"
            />
          </Link>

          <h1 className="pointer-events-none absolute left-1/2 top-1/2 w-[min(100%,16rem)] -translate-x-1/2 -translate-y-1/2 text-center text-base font-bold leading-tight tracking-tight sm:w-auto sm:max-w-[calc(100%-14rem)] sm:text-xl md:text-2xl">
            {title}
          </h1>

          <Button variant="outline" size="sm" className="relative z-10 hidden shrink-0 sm:inline-flex" asChild>
            <Link to="/">Back to home</Link>
          </Button>
          <Button variant="outline" size="icon" className="relative z-10 shrink-0 sm:hidden" asChild>
            <Link to="/" aria-label="Back to home">
              <Home className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </header>
      <main className="flex-1 px-4 py-8 sm:px-8 lg:px-12 pb-12">
        <article className="max-w-3xl mx-auto prose prose-neutral prose-sm sm:prose-base prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-neutral-900 prose-a:underline-offset-4">
          {children}
        </article>
      </main>
      <footer className="border-t border-neutral-200 px-4 py-6 sm:px-8 text-center text-xs text-neutral-500 space-y-3">
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-1" aria-label="Legal">
          <Link to="/privacy" className="hover:text-neutral-800 underline-offset-4 hover:underline">
            Privacy Policy
          </Link>
          <Link to="/terms" className="hover:text-neutral-800 underline-offset-4 hover:underline">
            Terms of Service
          </Link>
        </nav>
        <div>
          <a
            href="https://unifiedinboxhub.com/"
            className="hover:text-neutral-800 underline-offset-4 hover:underline"
            rel="noopener noreferrer"
          >
            unifiedinboxhub.com
          </a>
        </div>
      </footer>
    </div>
  );
}
