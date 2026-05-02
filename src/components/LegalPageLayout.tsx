import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type LegalPageLayoutProps = {
  title: string;
  children: ReactNode;
};

export function LegalPageLayout({ title, children }: LegalPageLayoutProps) {
  return (
    <div className="min-h-[100dvh] bg-white text-neutral-950 antialiased font-sans flex flex-col">
      <header className="border-b border-neutral-200 px-4 py-4 sm:px-8 lg:px-12 shrink-0">
        <div className="max-w-3xl mx-auto w-full flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">Unified Inbox Hub</p>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-1">{title}</h1>
          </div>
          <Link
            to="/"
            className="text-sm font-medium text-neutral-600 hover:text-neutral-950 underline-offset-4 hover:underline shrink-0 sm:mt-1"
          >
            Back to home
          </Link>
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
