import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Folder, ArrowLeft, File, Layers, Settings, ArrowRight } from "lucide-react";
import { Link, useLoaderData } from "react-router";
import { css } from "styled-system/css";

import { projectRepositoryContext } from "~/router-contexts";

import type { Route } from "./+types/route";

const topbarStyle = css({
  backgroundColor: "bg.panel",
  borderBottomWidth: "1px",
  borderColor: "border.panel",
});

const topbarInnerStyle = css({
  maxWidth: "3xl",
  marginInline: "auto",
  paddingInline: "4",
  height: "14",
  display: "flex",
  alignItems: "center",
  gap: "3",
});

const iconGhostButton = css({
  padding: "2",
  borderRadius: "lg",
  color: "fg.muted",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: { backgroundColor: { base: "gray.100", _dark: "gray.800" } },
});

const crumbLink = css({
  paddingInline: "2",
  paddingBlock: "1",
  textStyle: "xs",
  borderRadius: "sm",
  flexShrink: 0,
  _hover: { backgroundColor: { base: "gray.200", _dark: "gray.700" } },
});

const recentDirStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "2",
  width: "full",
  textAlign: "left",
  paddingInline: "3",
  paddingBlock: "2.5",
  borderRadius: "lg",
  textStyle: "sm",
  color: "fg.secondary",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: { backgroundColor: { base: "gray.100", _dark: "gray.800" } },
});

const entryRowBase = {
  display: "flex",
  alignItems: "center",
  gap: "2",
  width: "full",
  textAlign: "left",
  paddingInline: "4",
  paddingBlock: "2.5",
  textStyle: "sm",
};

const dirRowStyle = css({
  ...entryRowBase,
  _hover: { backgroundColor: { base: "gray.100", _dark: "gray.800" } },
});

const fileRowStyle = css({
  ...entryRowBase,
  cursor: "default",
  color: "gray.500",
});

const parentRowStyle = css({
  ...entryRowBase,
  color: "fg.muted",
  borderBottomWidth: "1px",
  borderColor: { base: "gray.100", _dark: "gray.800" },
  _hover: { backgroundColor: { base: "gray.100", _dark: "gray.800" } },
});

const ctaStyle = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "2",
  width: "full",
  backgroundColor: "action",
  color: "white",
  fontWeight: "medium",
  paddingBlock: "2.5",
  paddingInline: "4",
  borderRadius: "lg",
  textStyle: "sm",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: { backgroundColor: "action.hover" },
});

const truncateStyle = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

export function meta(_: Route.MetaArgs) {
  return [{ title: "Pi UI - Select Directory" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const projectRepository = context.get(projectRepositoryContext);

  const url = new URL(request.url);
  const dirFromUrl = url.searchParams.get("dir");

  const homeDir = homedir();
  const recentDirs = projectRepository.list();
  const currentDir = dirFromUrl || homeDir;

  let entries: { name: string; path: string; isDirectory: boolean }[] = [];
  try {
    const dirents = await readdir(currentDir, { withFileTypes: true });
    entries = dirents
      .map((e) => ({
        name: e.name,
        path: path.join(currentDir, e.name),
        isDirectory: e.isDirectory(),
      }))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
  } catch {
    entries = [];
  }

  // Build breadcrumbs from currentDir
  const parts = currentDir.split("/").filter(Boolean);
  const breadcrumbs: { name: string; path: string }[] = [];
  let cum = "";
  for (const part of parts) {
    cum += "/" + part;
    breadcrumbs.push({ name: part, path: cum });
  }
  if (breadcrumbs.length === 0) breadcrumbs.push({ name: "/", path: "/" });

  return { homeDir, recentDirs, currentDir, entries, breadcrumbs };
}

export default function Home() {
  const { homeDir, recentDirs, currentDir, entries, breadcrumbs } = useLoaderData<typeof loader>();

  const parentDir = currentDir.substring(0, currentDir.lastIndexOf("/")) || "/";

  return (
    <div className={css({ height: "full", display: "flex", flexDirection: "column" })}>
      {/* Top bar */}
      <div className={topbarStyle}>
        <div className={topbarInnerStyle}>
          <Layers className={css({ width: "5", height: "5", color: "blue.500" })} />
          <span className={css({ fontWeight: "semibold", color: "fg.primary" })}>
            Select Working Directory
          </span>
          <div
            className={css({ marginLeft: "auto", display: "flex", alignItems: "center", gap: "2" })}
          >
            <Link to="/settings" aria-label="Settings" className={iconGhostButton}>
              <Settings className={css({ width: "5", height: "5" })} />
            </Link>
          </div>
        </div>
      </div>

      <div
        className={css({
          flex: "1",
          maxWidth: "3xl",
          marginInline: "auto",
          width: "full",
          padding: "6",
        })}
      >
        {/* Recent Directories */}
        {recentDirs.length > 0 && (
          <div className={css({ marginBottom: "6" })}>
            <h2
              className={css({
                textStyle: "sm",
                fontWeight: "medium",
                color: "fg.secondary",
                marginBottom: "2",
              })}
            >
              Recent Directories
            </h2>
            <div
              className={css({
                "& > :not([hidden]) ~ :not([hidden])": { marginTop: "1" },
              })}
            >
              {recentDirs.map((dir) => (
                <Link
                  key={dir.path}
                  to={`/session?dir=${encodeURIComponent(dir.path)}`}
                  className={recentDirStyle}
                >
                  <Folder
                    className={css({ width: "4", height: "4", flexShrink: 0, color: "amber.500" })}
                  />
                  <span className={truncateStyle}>{dir.path}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Directory Picker */}
        <div
          className={css({
            backgroundColor: "bg.panel",
            borderWidth: "1px",
            borderColor: "border.panel",
            borderRadius: "xl",
            overflow: "hidden",
          })}
        >
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "1",
              padding: "2",
              borderBottomWidth: "1px",
              borderColor: "border.panel",
              backgroundColor: { base: "gray.50", _dark: "gray.900" },
              overflowX: "auto",
            })}
          >
            <Link to={`/?dir=${encodeURIComponent(homeDir)}`} replace className={crumbLink}>
              ~
            </Link>
            <span className={css({ color: "gray.400", flexShrink: 0 })}>/</span>
            {breadcrumbs.map((crumb, i) => (
              <span
                key={crumb.path}
                className={css({ display: "flex", alignItems: "center", gap: "1", flexShrink: 0 })}
              >
                {i > 0 && <span className={css({ color: "gray.400" })}>/</span>}
                {i < breadcrumbs.length - 1 ? (
                  <Link
                    to={`/?dir=${encodeURIComponent(crumb.path)}`}
                    replace
                    className={crumbLink}
                  >
                    {crumb.name}
                  </Link>
                ) : (
                  <span
                    className={css({
                      paddingInline: "2",
                      paddingBlock: "1",
                      textStyle: "xs",
                      fontWeight: "medium",
                      color: "fg.primary",
                    })}
                  >
                    {crumb.name}
                  </span>
                )}
              </span>
            ))}
          </div>

          <div className={css({ maxHeight: "20rem", overflowY: "auto" })}>
            <Link to={`/?dir=${encodeURIComponent(parentDir)}`} replace className={parentRowStyle}>
              <ArrowLeft className={css({ width: "4", height: "4" })} />
              ..
            </Link>
            {entries.map((entry) =>
              entry.isDirectory ? (
                <Link
                  key={entry.path}
                  to={`/?dir=${encodeURIComponent(entry.path)}`}
                  replace
                  className={dirRowStyle}
                >
                  <Folder
                    className={css({ width: "4", height: "4", color: "amber.500", flexShrink: 0 })}
                  />
                  <span className={truncateStyle}>{entry.name}</span>
                </Link>
              ) : (
                <div key={entry.path} className={fileRowStyle}>
                  <File
                    className={css({ width: "4", height: "4", color: "gray.400", flexShrink: 0 })}
                  />
                  <span className={truncateStyle}>{entry.name}</span>
                </div>
              ),
            )}
            {entries.length === 0 && (
              <p
                className={css({
                  paddingInline: "4",
                  paddingBlock: "8",
                  textAlign: "center",
                  color: "gray.400",
                  textStyle: "sm",
                })}
              >
                Empty directory
              </p>
            )}
          </div>

          <div
            className={css({
              padding: "4",
              borderTopWidth: "1px",
              borderColor: "border.panel",
              backgroundColor: { base: "gray.50", _dark: "gray.900" },
            })}
          >
            <Link to={`/session?dir=${encodeURIComponent(currentDir)}`} className={ctaStyle}>
              Use This Directory
              <ArrowRight className={css({ width: "4", height: "4" })} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
