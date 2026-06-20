import { ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { AppPasswordGuide } from "@/lib/mail-provider-presets";

export function AppPasswordSetupAlert({ guide }: { guide: AppPasswordGuide }) {
  return (
    <Alert className="border-blue-500/25 bg-blue-500/[0.06] dark:bg-blue-950/20">
      <ShieldCheck className="size-4 text-blue-600" aria-hidden />
      <AlertTitle className="text-sm">{guide.alertTitle}</AlertTitle>
      <AlertDescription className="text-xs text-muted-foreground space-y-2">
        <p>{guide.intro}</p>
        <p>
          <a
            href={guide.linkHref}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline underline-offset-2"
          >
            {guide.linkLabel}
          </a>
          {guide.linkSuffix ? ` ${guide.linkSuffix}` : null}
        </p>
        {guide.footnote ? <p className="text-[11px]">{guide.footnote}</p> : null}
      </AlertDescription>
    </Alert>
  );
}
