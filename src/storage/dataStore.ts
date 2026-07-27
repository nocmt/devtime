import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface TimeEntry {
  start: string;
  end: string;
  duration: number;
  type: 'manual_edit' | 'agent_edit' | 'file_view';
  filePath?: string;
}

export interface DailyRecord {
  date: string;
  entries: TimeEntry[];
  totalSeconds: number;
}

export interface ProjectData {
  name: string;
  displayPath: string;
  records: Record<string, DailyRecord>;
}

export interface WorkTimeData {
  version: number;
  projects: Record<string, ProjectData>;
}

const DATA_VERSION = 2;

export class DataStore {
  private data: WorkTimeData;
  private dataPath: string;
  private currentProjectId: string | null = null;
  private currentProjectName: string;
  private currentProjectPath: string;

  constructor(workspaceFolder: string, storagePath?: string) {
    this.currentProjectName = path.basename(workspaceFolder);
    this.currentProjectPath = workspaceFolder;
    this.currentProjectId = this.sanitizeProjectId(this.currentProjectName);

    if (storagePath && storagePath.trim()) {
      this.dataPath = path.join(storagePath.trim(), 'devtime-data.json');
    } else {
      this.dataPath = path.join(os.homedir(), '.devtime', 'devtime-data.json');
    }

    this.data = { version: DATA_VERSION, projects: {} };
  }

  private sanitizeProjectId(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').toLowerCase();
  }

  getProjectId(): string { return this.currentProjectId!; }
  getProjectName(): string { return this.currentProjectName; }
  getStoragePath(): string { return this.dataPath; }

  async init(): Promise<void> {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.dataPath)) {
      const loaded = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
      if (loaded.version === 1 && loaded.records) {
        this.data = { version: DATA_VERSION, projects: { [this.sanitizeProjectId(this.currentProjectName)]: { name: this.currentProjectName, displayPath: this.currentProjectPath, records: loaded.records } } };
        await this.saveData();
      } else {
        this.data = loaded;
      }
    }
    this.ensureProject();
  }

  private ensureProject(): void {
    if (!this.currentProjectId) return;
    if (!this.data.projects[this.currentProjectId]) {
      this.data.projects[this.currentProjectId] = { name: this.currentProjectName, displayPath: this.currentProjectPath, records: {} };
    } else {
      this.data.projects[this.currentProjectId].displayPath = this.currentProjectPath;
    }
  }

  async saveData(): Promise<void> {
    const json = JSON.stringify(this.data, null, 2);
    fs.writeFileSync(this.dataPath, json, 'utf-8');
  }

  async addEntry(entry: TimeEntry): Promise<void> {
    if (!this.currentProjectId) return;
    this.ensureProject();
    const today = new Date().toISOString().split('T')[0];
    const project = this.data.projects[this.currentProjectId];
    if (!project.records[today]) project.records[today] = { date: today, entries: [], totalSeconds: 0 };
    project.records[today].entries.push(entry);
    project.records[today].totalSeconds += entry.duration;
    await this.saveData();
  }

  getCurrentProjectData(): { name: string; records: Record<string, DailyRecord> } {
    if (!this.currentProjectId || !this.data.projects[this.currentProjectId]) return { name: this.currentProjectName, records: {} };
    return { name: this.data.projects[this.currentProjectId].name, records: this.data.projects[this.currentProjectId].records };
  }

  getProjectData(projectId: string): { name: string; records: Record<string, DailyRecord> } | null {
    const p = this.data.projects[projectId];
    return p ? { name: p.name, records: p.records } : null;
  }

  getTodayRecord(): DailyRecord | undefined {
    if (!this.currentProjectId) return undefined;
    return this.data.projects[this.currentProjectId]?.records[new Date().toISOString().split('T')[0]];
  }

  getAllProjectsSummary(): Array<{ id: string; name: string; totalSeconds: number }> {
    return Object.entries(this.data.projects).map(([id, p]) => ({
      id, name: p.name,
      totalSeconds: Object.values(p.records).reduce((s, r) => s + r.totalSeconds, 0),
    })).sort((a, b) => b.totalSeconds - a.totalSeconds);
  }
}
