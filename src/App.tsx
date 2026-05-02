import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { AuthProvider } from "@/hooks/useAuth";
import { InstallAppBanner } from "@/components/InstallAppBanner.tsx";
import { OutboxProcessor } from "@/components/OutboxProcessor";
import Index from "./pages/Index.tsx";
import Auth from "./pages/Auth.tsx";
import NotFound from "./pages/NotFound.tsx";
import PrivacyPolicy from "./pages/PrivacyPolicy.tsx";
import TermsOfService from "./pages/TermsOfService.tsx";
import Contacts from "./pages/Contacts.tsx";

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background">
      <InstallAppBanner />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <OutboxProcessor />
          <Sentry.ErrorBoundary
            fallback={({ error, resetError }) => (
              <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center">
                <p className="text-sm text-muted-foreground max-w-md">
                  Something went wrong{import.meta.env.DEV && error instanceof Error ? `: ${error.message}` : ""}.
                </p>
                <Button type="button" onClick={() => resetError()}>
                  Try again
                </Button>
              </div>
            )}
          >
            <AppRoutes />
          </Sentry.ErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
