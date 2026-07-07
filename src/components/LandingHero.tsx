import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { InstallAppButton } from "@/components/InstallAppBanner";

export const LandingHero = () => {
  useEffect(() => {
    document.title = "Unified Inbox Hub";
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-white text-neutral-950 antialiased font-sans lg:flex-row lg:overflow-visible">
      {/* Left: brand + copy */}
      <div className="flex min-h-0 flex-1 flex-col justify-between overflow-hidden px-5 pt-5 pb-5 md:px-10 md:pt-10 md:pb-12 lg:max-w-none lg:overflow-visible lg:px-14 lg:pt-12 lg:pb-14 xl:px-20 xl:pt-16 max-w-[920px]">
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 text-sm md:text-base">
          <span className="flex items-center gap-2.5 shrink-0" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 22 22" className="text-neutral-950">
              <path d="M4 18 L16 2" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
              <path d="M7 20 L19 4" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
            </svg>
            <span className="font-semibold tracking-tight text-lg md:text-xl">
              Unified Inbox Hub
            </span>
          </span>
          <span className="hidden md:inline h-4 w-px bg-neutral-300 shrink-0" aria-hidden />
          <span className="w-full pl-[30px] text-sm font-normal text-neutral-500 md:w-auto md:pl-0 md:text-[15px]">
            Built for unified communications
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col justify-center py-4 max-md:py-3 md:py-12 lg:py-16 max-w-xl lg:max-w-2xl">
          <h1 className="text-[1.625rem] font-bold leading-[1.12] tracking-tight text-neutral-950 max-md:tracking-tight md:text-5xl md:leading-[1.06] lg:text-[3.25rem] lg:leading-[1.05] xl:text-[3.5rem]">
            The central command
            <br />
            for all your
            <br />
            communications.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-snug text-neutral-600 md:mt-6 md:text-lg md:leading-relaxed">
            Secure, modular workspace that brings every inbox together. Consolidate email and messages
            into one calm surface—stay focused, stay organized.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3 md:mt-10">
            <Button
              asChild
              size="lg"
              className="h-11 rounded-md bg-neutral-950 px-7 text-[14px] font-medium text-white shadow-none hover:bg-neutral-900 md:h-12 md:px-8 md:text-[15px]"
            >
              <Link to="/auth">Sign in</Link>
            </Button>
            <InstallAppButton />
          </div>
        </div>

        <p className="max-w-md shrink-0 text-[11px] leading-snug text-neutral-400 md:text-sm md:leading-relaxed">
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

      {/* Right: abstract gradient panel — fixed slice on mobile so the hero fits 100dvh without scroll */}
      <div className="relative h-[26dvh] max-h-[200px] min-h-0 w-full shrink-0 overflow-hidden md:h-auto md:max-h-none md:min-h-[280px] lg:flex-[0_0_42%] lg:min-h-0 xl:flex-[0_0_40%]">
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
