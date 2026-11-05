import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { Shell } from "@/components/Shell";
import { Toaster } from "@/components/ui/sonner";
import { ShareSheet } from "@/components/ShareSheet";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LoopgramChannel" },
      { name: "description", content: "Endless movie and TV discovery." },
      { name: "theme-color", content: "#0f0f0f" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Loopgram" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "shortcut icon", href: "/favicon.ico" },
      { rel: "icon", href: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { rel: "icon", href: "/icon-512.png", type: "image/png", sizes: "512x512" },
      { rel: "icon", href: "/favicon.png", type: "image/png", sizes: "64x64" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icon-192.png", sizes: "192x192" },
      { rel: "preconnect", href: "https://www.youtube-nocookie.com" },
      { rel: "dns-prefetch", href: "https://www.youtube-nocookie.com" },
      { rel: "preconnect", href: "https://www.youtube.com" },
      { rel: "dns-prefetch", href: "https://www.youtube.com" },
      { rel: "preconnect", href: "https://i.ytimg.com" },
      { rel: "preconnect", href: "https://media.loopgramchannel.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://media.loopgramchannel.com" },
      { rel: "dns-prefetch", href: "https://i.ytimg.com" },
      { rel: "preconnect", href: "https://www.gstatic.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://googlevideo.com" },
      { rel: "dns-prefetch", href: "https://jnn-pa.googleapis.com" },
      { rel: "dns-prefetch", href: "https://static.doubleclick.net" },
      { rel: "preconnect", href: "https://googleads.g.doubleclick.net" },
      { rel: "dns-prefetch", href: "https://googleads.g.doubleclick.net" },
      { rel: "dns-prefetch", href: "https://www.google.com" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap" },
    ],
    scripts: [
      {
        async: true,
        src: "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1332482197214084",
        crossOrigin: "anonymous",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <AuthProvider>
        <Frame />
      </AuthProvider>
      <Toaster position="bottom-center" />
      <ShareSheet />

    </QueryClientProvider>
  );
}

/** Studio has its own layout; public pages get the site Shell, banner and maintenance gate. */
function Frame() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const { settings } = useAuth();
  if (path.startsWith("/studio")) return <Outlet />;
  const open = path.startsWith("/login");
  return (
    <>
      {settings?.bannerOn && settings.banner && (
        <div role="status" className="bg-primary px-4 py-2 text-center text-sm text-primary-foreground">{settings.banner}</div>
      )}
      <Shell>
        {settings?.maintenance && !open ? (
          <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
            <h1 className="text-2xl font-black">LoopgramChannel will be back soon</h1>
            <p className="mt-2 text-sm text-muted-foreground">We're making improvements. Please check back shortly.</p>
          </div>
        ) : (
          <Outlet />
        )}
      </Shell>
    </>
  );
}
