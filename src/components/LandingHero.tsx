import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const LandingHero = () => {
  useEffect(() => {
    document.title = "Unified Inbox Hub";
  }, []);

  return (
    <div className="min-h-[100dvh] flex flex-col lg:flex-row bg-white text-neutral-950 antialiased font-sans">
      {/* Left: brand + copy */}
      <div className="flex-1 flex flex-col justify-between px-6 pt-8 pb-10 sm:px-10 sm:pt-10 sm:pb-12 lg:px-14 lg:pt-12 lg:pb-14 xl:px-20 xl:pt-16 max-w-[920px] lg:max-w-none">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm sm:text-base">
          <span className="flex items-center gap-2.5 shrink-0" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 22 22" className="text-neutral-950">
              <path d="M4 18 L16 2" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
              <path d="M7 20 L19 4" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
            </svg>
            <span className="font-semibold tracking-tight lowercase text-lg sm:text-xl">
              Unified Inbox Hub
            </span>
          </span>
          <span className="hidden sm:inline h-4 w-px bg-neutral-300 shrink-0" aria-hidden />
          <span className="text-neutral-500 font-normal text-sm sm:text-[15px] w-full sm:w-auto pl-[30px] sm:pl-0">
            Built for unified communications
          </span>
        </header>

        <div className="flex-1 flex flex-col justify-center py-12 lg:py-16 max-w-xl lg:max-w-2xl">
          <h1 className="text-[2.35rem] leading-[1.08] sm:text-5xl sm:leading-[1.06] lg:text-[3.25rem] lg:leading-[1.05] xl:text-[3.5rem] font-bold tracking-tight text-neutral-950">
            The central command
            <br />
            for all your
            <br />
            communications.
          </h1>
          <p className="mt-6 text-base sm:text-lg text-neutral-600 font-normal leading-relaxed max-w-lg">
            Secure, modular workspace that brings every inbox together. Consolidate email and messages
            into one calm surface—stay focused, stay organized.
          </p>
          <div className="mt-10">
            <Button
              asChild
              size="lg"
              className="rounded-md bg-neutral-950 text-white hover:bg-neutral-900 px-8 h-12 text-[15px] font-medium shadow-none"
            >
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>

        <p className="text-xs sm:text-sm text-neutral-400 font-normal max-w-md leading-relaxed">
          TLS encryption and OAuth sign-in—your mail stays private to you.{" "}
          <span className="text-neutral-500">
            <Link to="/privacy" className="underline underline-offset-2 hover:text-neutral-700">
              Privacy Policy
            </Link>
            <span className="mx-1.5" aria-hidden>
              ·
            </span>
            <Link to="/terms" className="underline underline-offset-2 hover:text-neutral-700">
              Terms of Service
            </Link>
          </span>
        </p>
      </div>

      {/* Right: abstract gradient panel */}
      <div className="relative lg:flex-[0_0_42%] xl:flex-[0_0_40%] min-h-[220px] sm:min-h-[280px] lg:min-h-0 w-full overflow-hidden">
        <div
          className="absolute inset-0 origin-top-right scale-110 lg:scale-100"
          style={{
            background: `
              radial-gradient(ellipse 90% 70% at 85% 15%, rgba(168, 85, 247, 0.92), transparent 52%),
              radial-gradient(ellipse 75% 55% at 55% 45%, rgba(59, 130, 246, 0.78), transparent 48%),
              radial-gradient(ellipse 65% 50% at 15% 75%, rgba(249, 115, 22, 0.72), transparent 45%),
              radial-gradient(ellipse 55% 45% at 70% 85%, rgba(234, 179, 8, 0.55), transparent 42%),
              radial-gradient(ellipse 50% 40% at 95% 65%, rgba(236, 72, 153, 0.65), transparent 40%),
              linear-gradient(165deg, rgba(15, 23, 42, 0.35) 0%, transparent 35%, rgba(88, 28, 135, 0.25) 100%)
            `,
            filter: "saturate(1.15) contrast(1.05)",
          }}
        />
        <div
          className="absolute inset-0 mix-blend-overlay opacity-40"
          style={{
            background:
              "repeating-linear-gradient(-35deg, transparent, transparent 2px, rgba(255,255,255,0.06) 2px, rgba(255,255,255,0.06) 4px)",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "linear-gradient(-28deg, transparent 38%, rgba(255,255,255,0.12) 48%, transparent 58%)",
          }}
        />
      </div>
    </div>
  );
};
