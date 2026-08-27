import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { Folder, ArrowLeft, File, Layers, Settings, ArrowRight } from "lucide-react";
import { Link, useLoaderData } from "react-router";
import { css, cx } from "styled-system/css";
import { flex } from "styled-system/patterns";
import { button, card, iconButton, topbar } from "styled-system/recipes";

import { projectRepositoryContext } from "~/router-contexts";

import type { Route } from "./+types/route";

const topbarClasses = topbar();

const iconGhostButton = iconButton();

const crumbLink = css({
  paddingInline: "2",
  paddingBlock: "1",
  textStyle: "xs",
  borderRadius: "sm",
  flexShrink: 0,
  _hover: { backgroundColor: "primary.wash" },
});

const recentDirStyle = flex({
  align: "center",
  gap: "2",
  width: "full",
  textAlign: "left",
  paddingInline: "3",
  paddingBlock: "2.5",
  borderRadius: "lg",
  textStyle: "sm",
  color: "secondary.fg",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  transitionProperty: "colors",
  transitionDuration: "150ms",
  _hover: { backgroundColor: "secondary.wash" },
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
  _hover: { backgroundColor: "primary.wash" },
});

const fileRowStyle = css({
  ...entryRowBase,
  cursor: "default",
  color: "muted.fg",
});

const parentRowStyle = css({
  ...entryRowBase,
  color: "muted.fg",
  borderBottomWidth: "1px",
  borderColor: "divider.border",
  _hover: { backgroundColor: "muted.wash" },
});

const ctaStyle = cx(
  button(),
  flex({
    align: "center",
    justify: "center",
    gap: "2",
    width: "full",
    fontWeight: "medium",
    paddingBlock: "2.5",
    paddingInline: "4",
    textStyle: "sm",
  }),
);

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
    <div className={flex({ height: "full", direction: "column" })}>
      {/* Top bar */}
      <div className={topbarClasses.root}>
        <div className={topbarClasses.inner}>
          <Layers className={css({ width: "5", height: "5", color: "info" })} />
          <span className={css({ fontWeight: "semibold", color: "primary.fg" })}>
            Select Working Directory
          </span>
          <div className={flex({ marginLeft: "auto", align: "center", gap: "2" })}>
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
                color: "secondary.fg",
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
                    className={css({
                      width: "4",
                      height: "4",
                      flexShrink: 0,
                      color: "warning.icon",
                    })}
                  />
                  <span className={truncateStyle}>{dir.path}</span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Directory Picker */}
        <div
          className={cx(
            card(),
            css({
              overflow: "hidden",
            }),
          )}
        >
          <div
            className={flex({
              align: "center",
              gap: "1",
              padding: "2",
              borderBottomWidth: "1px",
              borderColor: "panel.border",
              backgroundColor: "subtle.bg",
              overflowX: "auto",
            })}
          >
            <Link to={`/?dir=${encodeURIComponent(homeDir)}`} replace className={crumbLink}>
              ~
            </Link>
            <span className={css({ color: "subtle.fg", flexShrink: 0 })}>/</span>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className={flex({ align: "center", gap: "1", flexShrink: 0 })}>
                {i > 0 && <span className={css({ color: "subtle.fg" })}>/</span>}
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
                      color: "primary.fg",
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
                    className={css({
                      width: "4",
                      height: "4",
                      color: "warning.icon",
                      flexShrink: 0,
                    })}
                  />
                  <span className={truncateStyle}>{entry.name}</span>
                </Link>
              ) : (
                <div key={entry.path} className={fileRowStyle}>
                  <File
                    className={css({ width: "4", height: "4", color: "subtle.fg", flexShrink: 0 })}
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
                  color: "subtle.fg",
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
              borderColor: "panel.border",
              backgroundColor: "subtle.bg",
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
