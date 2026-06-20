import { useState } from "react";
import { Download, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall } from "@/hooks/usePwaInstall";

function InstallInstructions({ showChromeInstall, isIOS }: { showChromeInstall: boolean; isIOS: boolean }) {
  if (showChromeInstall) {
    return (
      <p className="text-muted-foreground text-xs leading-snug">
        Add to your home screen for quicker access and notifications.
      </p>
    );
  }
  if (isIOS) {
    return (
      <p className="text-muted-foreground text-xs leading-snug">
        Tap <strong className="text-foreground">Share</strong>{" "}
        <span className="inline-flex align-middle opacity-80">□↑</span> then{" "}
        <strong className="text-foreground">Add to Home Screen</strong>.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs leading-snug">
      Open your browser menu and choose <strong className="text-foreground">Install app</strong> or{" "}
      <strong className="text-foreground">Add to Home screen</strong>.
    </p>
  );
}

/** Compact install prompt for the inbox sidebar. */
export function InstallAppSidebar() {
  const { showInstall, canPromptInstall, isIOS, runInstall, dismiss } = usePwaInstall();

  if (!showInstall) return null;

  const handleInstall = async () => {
    if (canPromptInstall) await runInstall();
  };

  return (
    <div className="shrink-0 border-t border-sidebar-border px-3 py-2.5" role="region" aria-label="Install app">
      <div className="flex items-start gap-2">
        {isIOS ? (
          <Share2 className="size-4 shrink-0 text-primary mt-0.5" aria-hidden />
        ) : (
          <Download className="size-4 shrink-0 text-primary mt-0.5" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-sidebar-foreground">Install app</p>
          <InstallInstructions showChromeInstall={canPromptInstall} isIOS={isIOS} />
          {canPromptInstall && (
            <Button
              type="button"
              size="sm"
              className="mt-2 h-7 gap-1.5 text-xs"
              onClick={() => void handleInstall()}
            >
              <Download className="size-3.5" />
              Install
            </Button>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Install button for the landing page (opens instructions dialog when native prompt is unavailable). */
export function InstallAppButton() {
  const { showInstall, canPromptInstall, isIOS, runInstall } = usePwaInstall();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!showInstall) return null;

  const handleClick = async () => {
    if (canPromptInstall) {
      await runInstall();
      return;
    }
    setDialogOpen(true);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-11 rounded-md border-neutral-300 bg-white px-7 text-[14px] font-medium text-neutral-950 shadow-none hover:bg-neutral-50 md:h-12 md:px-8 md:text-[15px]"
        onClick={() => void handleClick()}
      >
        <Download className="size-4 mr-2" />
        Install app
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install Unified Inbox Hub</DialogTitle>
            <DialogDescription asChild>
              <div className="pt-1">
                <InstallInstructions showChromeInstall={false} isIOS={isIOS} />
              </div>
            </DialogDescription>
          </DialogHeader>
          <Button type="button" className="w-full" onClick={() => setDialogOpen(false)}>
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
