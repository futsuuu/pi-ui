import { useEffect } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import "./app.css";
import type { Route } from "./+types/root";
import { ThemeProvider, ThemeScript } from "./contexts/theme";
import { agentSessionContainerContext, workspaceRepositoryContext } from "./router-contexts";
import { getSingletonContainer } from "./singleton-container";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "preconnect", href: "https://rsms.me/" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono&display=swap",
  },
  { rel: "stylesheet", href: "https://rsms.me/inter/inter.css" },
];

export const middleware: Route.MiddlewareFunction[] = [
  async ({ context }) => {
    const container = await getSingletonContainer();
    context.set(agentSessionContainerContext, container.agentSessionContainer);
    context.set(workspaceRepositoryContext, container.workspaceRepository);
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  // Global visualViewport handler – updates --visual-viewport-height on :root
  // so all pages can use var(--visual-viewport-height, 100dvh) for correct
  // layout on mobile browsers where the virtual keyboard changes the viewport.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const root = document.documentElement;
    const updateHeight = () => {
      root.style.setProperty("--visual-viewport-height", `${window.visualViewport!.height}px`);
    };
    window.visualViewport.addEventListener("resize", updateHeight);
    updateHeight();
    return () => {
      window.visualViewport?.removeEventListener("resize", updateHeight);
    };
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, interactive-widget=resizes-content"
        />
        <Meta />
        <Links />
        <ThemeScript />
      </head>
      <body className="bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 h-(--visual-viewport-height,100dvh) flex flex-col">
        <ThemeProvider>
          <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
