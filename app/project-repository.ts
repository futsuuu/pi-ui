import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

interface Project {
  path: string;
  lastOpened: number;
}

export class ProjectRepository {
  private projects: Project[] = [];
  private jsonFilePath: string | null;

  public constructor(options: { inMemory?: boolean } = {}) {
    if (options.inMemory) {
      this.jsonFilePath = null;
      return;
    }
    const stateDir = process.env.XDG_STATE_HOME
      ? path.join(process.env.XDG_STATE_HOME, "pi-ui")
      : path.join(homedir(), ".local", "state", "pi-ui");
    this.jsonFilePath = path.join(stateDir, "projects.json");
    this.load();
  }

  public list() {
    return this.projects.slice(0, 10);
  }

  public async add(dirPath: string) {
    this.projects = this.projects.filter((d) => d.path !== dirPath);
    this.projects.unshift({ path: dirPath, lastOpened: Date.now() });
    if (this.projects.length > 20) this.projects = this.projects.slice(0, 20);
    await this.save();
  }

  private load() {
    if (this.jsonFilePath === null) return;
    try {
      const data = readFileSync(this.jsonFilePath, "utf-8");
      this.projects = JSON.parse(data);
    } catch {
      this.projects = [];
    }
  }

  private async save() {
    if (this.jsonFilePath === null) return;
    try {
      await mkdir(path.dirname(this.jsonFilePath), { recursive: true });
      await writeFile(this.jsonFilePath, JSON.stringify(this.projects, null, 2));
    } catch {}
  }
}
