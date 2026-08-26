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
import { css } from "styled-system/css";

import type { Route } from "./+types/root";
import { SessionEventProvider } from "./contexts/session-events";
import { ThemeProvider, ThemeScript } from "./contexts/theme";
import {
  agentSessionContainerContext,
  projectRepositoryContext,
  worktreeRepositoryContext,
} from "./router-contexts";
import { getSingletonContainer } from "./singleton-container";

import pandaStylesheet from "./panda.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: pandaStylesheet },
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
    context.set(projectRepositoryContext, container.projectRepository);
    context.set(worktreeRepositoryContext, container.worktreeRepository);
  },
];

const bodyStyle = css({
  height: "var(--visual-viewport-height, 100dvh)",
  display: "flex",
  flexDirection: "column",
});

const wrapperStyle = css({ flex: "1", minHeight: 0, display: "flex", flexDirection: "column" });

// Mirrors Tailwind's `container` utility: full width capped per breakpoint,
// centered, with the page's own padding.
const errorMainStyle = css({
  padding: "4",
  paddingTop: "16",
  marginInline: "auto",
  width: "100%",
  sm: { maxWidth: "40rem" },
  md: { maxWidth: "48rem" },
  lg: { maxWidth: "64rem" },
  xl: { maxWidth: "80rem" },
  "2xl": { maxWidth: "96rem" },
});

const errorStackStyle = css({ width: "full", padding: "4", overflowX: "auto" });

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
      <body className={bodyStyle}>
        <ThemeProvider>
          <SessionEventProvider>
            <div className={wrapperStyle}>{children}</div>
          </SessionEventProvider>
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
    <main className={errorMainStyle}>
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className={errorStackStyle}>
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
