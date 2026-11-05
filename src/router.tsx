import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// After a redeploy/restart, old page chunks vanish; reload once instead of showing a blank screen.
if (typeof window !== "undefined") {
  const reloadOnce = () => {
    if (sessionStorage.getItem("lg:chunk-reload")) return;
    sessionStorage.setItem("lg:chunk-reload", "1");
    window.location.reload();
  };
  window.addEventListener("vite:preloadError", reloadOnce);
  window.addEventListener("unhandledrejection", (e) => {
    if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(String(e.reason?.message ?? e.reason))) reloadOnce();
  });
  window.addEventListener("load", () => setTimeout(() => sessionStorage.removeItem("lg:chunk-reload"), 10_000));
}

export const getRouter = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, gcTime: 10 * 60_000 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
};
