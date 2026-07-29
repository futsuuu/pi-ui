import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

interface Workspace {
  path: string;
  lastOpened: number;
}

export class WorkspaceRepository {
  private workspaces: Workspace[] = [];
  private jsonFilePath: string | null;

  public constructor(options: { inMemory?: boolean } = {}) {
    if (options.inMemory) {
      this.jsonFilePath = null;
      return;
    }
    const stateDir = process.env.XDG_STATE_HOME
      ? path.join(process.env.XDG_STATE_HOME, "pi-ui")
      : path.join(homedir(), ".local", "state", "pi-ui");
    this.jsonFilePath = path.join(stateDir, "workspaces.json");
    this.load();
  }

  public list() {
    return this.workspaces.slice(0, 10);
  }

  public async add(dirPath: string) {
    this.workspaces = this.workspaces.filter((d) => d.path !== dirPath);
    this.workspaces.unshift({ path: dirPath, lastOpened: Date.now() });
    if (this.workspaces.length > 20) this.workspaces = this.workspaces.slice(0, 20);
    await this.save();
  }

  private load() {
    if (this.jsonFilePath === null) return;
    try {
      const data = readFileSync(this.jsonFilePath, "utf-8");
      this.workspaces = JSON.parse(data);
    } catch {
      this.workspaces = [];
    }
  }

  private async save() {
    if (this.jsonFilePath === null) return;
    try {
      await mkdir(path.dirname(this.jsonFilePath), { recursive: true });
      await writeFile(this.jsonFilePath, JSON.stringify(this.workspaces, null, 2));
    } catch {}
  }
}
