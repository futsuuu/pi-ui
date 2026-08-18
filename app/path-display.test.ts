import { describe, expect, it } from "vitest";

import { displayBashCommand, displayPath, displayToolArgs } from "./path-display";

const CWD = "/home/user/project";
const HOME = "/home/user";

describe("displayPath", () => {
  it("strips the cwd prefix from absolute paths", () => {
    expect(displayPath("/home/user/project/src/a.ts", CWD, HOME)).toBe("src/a.ts");
  });

  it("renders the cwd itself as a dot", () => {
    expect(displayPath("/home/user/project", CWD, HOME)).toBe(".");
  });

  it("replaces the home directory with a tilde", () => {
    expect(displayPath("/home/user/other/file", CWD, HOME)).toBe("~/other/file");
    expect(displayPath("/home/user", CWD, HOME)).toBe("~");
  });

  it("prefers the cwd prefix over the home prefix", () => {
    expect(displayPath("/home/user/project/x", CWD, HOME)).toBe("x");
  });

  it("drops a leading ./", () => {
    expect(displayPath("./src/a.ts", CWD, HOME)).toBe("src/a.ts");
    expect(displayPath("./", CWD, HOME)).toBe(".");
  });

  it("leaves relative and unrelated paths unchanged", () => {
    expect(displayPath("src/a.ts", CWD, HOME)).toBe("src/a.ts");
    expect(displayPath("/etc/hosts", CWD, HOME)).toBe("/etc/hosts");
    expect(displayPath("~/x", CWD, HOME)).toBe("~/x");
  });

  it("collapses duplicate slashes and trailing slashes", () => {
    expect(displayPath("/home/user/project//src/a.ts/", CWD, HOME)).toBe("src/a.ts");
  });

  it("does not treat a sibling of cwd as under cwd", () => {
    expect(displayPath("/home/user/project2/x", CWD, HOME)).toBe("~/project2/x");
  });

  it("tolerates a trailing slash on cwd and home", () => {
    expect(displayPath("/home/user/project/src/a.ts", `${CWD}/`, HOME)).toBe("src/a.ts");
    expect(displayPath("/home/user/x", CWD, `${HOME}/`)).toBe("~/x");
  });

  it("treats a root cwd or home as no rule", () => {
    expect(displayPath("/home/user/project/x", "/", "")).toBe("/home/user/project/x");
    expect(displayPath("/home/user/x", "", "/")).toBe("/home/user/x");
  });

  it("is a no-op without a cwd", () => {
    expect(displayPath("/foo/bar", "", HOME)).toBe("/foo/bar");
    expect(displayPath("/home/user/x", "", HOME)).toBe("~/x");
  });
});

describe("displayBashCommand", () => {
  it("abbreviates a leading cd directory", () => {
    expect(displayBashCommand("cd /home/user/project/src && pwd", CWD, HOME)).toBe("cd src && pwd");
  });

  it("replaces a home directory in cd with a tilde", () => {
    expect(displayBashCommand("cd /home/user/other && ls", CWD, HOME)).toBe("cd ~/other && ls");
  });

  it("drops the cd prefix when changing into the cwd", () => {
    expect(displayBashCommand("cd /home/user/project && ls", CWD, HOME)).toBe("ls");
    expect(displayBashCommand("cd /home/user/project && git status", CWD, HOME)).toBe("git status");
  });

  it("abbreviates a bare cd without &&", () => {
    expect(displayBashCommand("cd /home/user/other", CWD, HOME)).toBe("cd ~/other");
    expect(displayBashCommand("cd /home/user/project", CWD, HOME)).toBe("cd .");
  });

  it("leaves non-cd and quoted commands unchanged", () => {
    expect(displayBashCommand("ls -la", CWD, HOME)).toBe("ls -la");
    expect(displayBashCommand("cd - && ls", CWD, HOME)).toBe("cd - && ls");
    expect(displayBashCommand('cd "a b" && ls', CWD, HOME)).toBe('cd "a b" && ls');
    expect(displayBashCommand("cd src && ls", CWD, HOME)).toBe("cd src && ls");
  });
});

describe("displayToolArgs", () => {
  it("shortens the path and command fields", () => {
    expect(
      displayToolArgs(
        { path: "/home/user/project/src/a.ts", command: "cd /home/user/project && ls" },
        CWD,
        HOME,
      ),
    ).toEqual({ path: "src/a.ts", command: "ls" });
  });

  it("leaves other fields untouched", () => {
    const args = { path: "x.ts", content: "text" };
    expect(displayToolArgs(args, CWD, HOME)).toEqual(args);
  });
});
