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

interface ProjectMeta {
  name: string;
  displayPath: string;
  totalSeconds: number;
}

interface IndexData {
  version: number;
  projects: Record<string, ProjectMeta>;
}

const DATA_VERSION = 3;
const PROJECTS_DIR = 'projects';
const INDEX_FILE = 'projects-index.json';
const OLD_DATA_FILE = 'devtime-data.json';
const PROJECT_FILE_EXT = '.json';

/**
 * DataStore v3：
 * - 每个项目一个独立 JSON 文件：<dataRoot>/projects/<projectId>.json
 * - 一个轻量索引文件：<dataRoot>/projects-index.json（只含各项目的名称/路径/总时长，体积很小）
 * - 保存时只写「当前项目文件 + 索引」，不再重写全量聚合文件，实现增量更新
 */
export class DataStore {
  private dataRoot: string;
  private projectsDir: string;
  private indexPath: string;
  private currentProjectId: string | null = null;
  private currentProjectName: string;
  private currentProjectPath: string;
  private currentProject: ProjectData | null = null;
  private index: IndexData = { version: DATA_VERSION, projects: {} };

  constructor(workspaceFolder: string, storagePath?: string) {
    this.currentProjectName = path.basename(workspaceFolder);
    this.currentProjectPath = workspaceFolder;
    this.currentProjectId = this.sanitizeProjectId(this.currentProjectName);

    if (storagePath && storagePath.trim()) {
      const p = path.resolve(storagePath.trim());
      // 自定义目录：若所选目录本身就叫 .devtime 则直接用；否则在其内部创建 .devtime 子目录
      this.dataRoot = path.basename(p) === '.devtime' ? p : path.join(p, '.devtime');
    } else {
      this.dataRoot = path.join(os.homedir(), '.devtime');
    }

    this.projectsDir = path.join(this.dataRoot, PROJECTS_DIR);
    this.indexPath = path.join(this.dataRoot, INDEX_FILE);
  }

  private sanitizeProjectId(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').toLowerCase();
  }

  getProjectId(): string { return this.currentProjectId!; }
  getProjectName(): string { return this.currentProjectName; }

  /** 数据根目录（用于 UI 展示） */
  getStoragePath(): string { return this.dataRoot; }

  /** 当前项目的数据文件路径 */
  getProjectDataPath(): string {
    return path.join(this.projectsDir, this.currentProjectId + PROJECT_FILE_EXT);
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.dataRoot, { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });

    this.migrateLegacyIfNeeded();
    this.loadIndex();
    this.loadCurrentProject();

    // 首次运行/新项目时，落盘当前项目文件与索引
    await this.saveData();
  }

  /**
   * 迁移旧版单一聚合文件 devtime-data.json（v1/v2）→ 按项目拆分
   * 迁移完成后原文件保留为 devtime-data.json.migrated 备份，避免重复迁移
   */
  private migrateLegacyIfNeeded(): void {
    let legacyPath = path.join(this.dataRoot, OLD_DATA_FILE);
    if (!fs.existsSync(legacyPath)) {
      // 自定义目录场景下，旧文件可能位于所选目录（dataRoot 的父目录）而非 .devtime 子目录内
      const alt = path.join(path.dirname(this.dataRoot), OLD_DATA_FILE);
      if (path.basename(this.dataRoot) === '.devtime' && fs.existsSync(alt)) {
        legacyPath = alt;
      } else {
        return;
      }
    }

    let loaded: any;
    try {
      loaded = JSON.parse(fs.readFileSync(legacyPath, 'utf-8'));
    } catch {
      return;
    }

    const projects: Record<string, ProjectData> = {};
    if (loaded && loaded.version === 1 && loaded.records) {
      const pid = this.sanitizeProjectId(loaded.projectName || this.currentProjectName);
      projects[pid] = {
        name: loaded.projectName || this.currentProjectName,
        displayPath: loaded.displayPath || this.currentProjectPath,
        records: loaded.records,
      };
    } else if (loaded && loaded.projects) {
      Object.assign(projects, loaded.projects);
    } else {
      return;
    }

    for (const [id, p] of Object.entries(projects)) {
      this.writeJsonAtomic(path.join(this.projectsDir, id + PROJECT_FILE_EXT), {
        version: DATA_VERSION,
        name: p.name,
        displayPath: p.displayPath,
        records: p.records,
      });
    }

    // 备份旧文件并移除原始文件，防止重复迁移
    const backup = path.join(this.dataRoot, OLD_DATA_FILE + '.migrated');
    try {
      if (fs.existsSync(backup)) fs.rmSync(backup, { force: true });
      fs.renameSync(legacyPath, backup);
    } catch {
      try { fs.rmSync(legacyPath, { force: true }); } catch { /* ignore */ }
    }
  }

  /** 加载索引；若不存在则扫描 projects 目录重建 */
  private loadIndex(): void {
    if (fs.existsSync(this.indexPath)) {
      try {
        const idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        if (idx && idx.projects) {
          this.index = { version: DATA_VERSION, projects: idx.projects };
          return;
        }
      } catch { /* fall through to scan */ }
    }

    this.index = { version: DATA_VERSION, projects: {} };
    let files: string[] = [];
    try { files = fs.readdirSync(this.projectsDir).filter(f => f.endsWith(PROJECT_FILE_EXT)); } catch { return; }
    for (const f of files) {
      const id = f.slice(0, -PROJECT_FILE_EXT.length);
      try {
        const p = JSON.parse(fs.readFileSync(path.join(this.projectsDir, f), 'utf-8'));
        this.index.projects[id] = {
          name: p.name || id,
          displayPath: p.displayPath || '',
          totalSeconds: this.sumRecords(p.records),
        };
      } catch { /* ignore corrupted file */ }
    }
  }

  private loadCurrentProject(): void {
    if (!this.currentProjectId) return;
    if (fs.existsSync(this.getProjectDataPath())) {
      try {
        const p = JSON.parse(fs.readFileSync(this.getProjectDataPath(), 'utf-8'));
        this.currentProject = {
          name: p.name || this.currentProjectName,
          displayPath: p.displayPath || this.currentProjectPath,
          records: p.records || {},
        };
        return;
      } catch { /* fall through to empty */ }
    }
    this.currentProject = { name: this.currentProjectName, displayPath: this.currentProjectPath, records: {} };
  }

  private sumRecords(records: Record<string, DailyRecord> | undefined): number {
    if (!records) return 0;
    return Object.values(records).reduce((s, r) => s + (r?.totalSeconds || 0), 0);
  }

  /** 只写当前项目文件 + 轻量索引，实现增量更新 */
  async saveData(): Promise<void> {
    if (!this.currentProjectId || !this.currentProject) return;

    this.index.projects[this.currentProjectId] = {
      name: this.currentProject.name,
      displayPath: this.currentProject.displayPath,
      totalSeconds: this.sumRecords(this.currentProject.records),
    };

    this.writeJsonAtomic(this.getProjectDataPath(), {
      version: DATA_VERSION,
      name: this.currentProject.name,
      displayPath: this.currentProject.displayPath,
      records: this.currentProject.records,
    });
    this.writeJsonAtomic(this.indexPath, this.index);
  }

  async addEntry(entry: TimeEntry): Promise<void> {
    if (!this.currentProjectId || !this.currentProject) return;
    const today = new Date().toISOString().split('T')[0];
    if (!this.currentProject.records[today]) {
      this.currentProject.records[today] = { date: today, entries: [], totalSeconds: 0 };
    }
    this.currentProject.records[today].entries.push(entry);
    this.currentProject.records[today].totalSeconds += entry.duration;
    await this.saveData();
  }

  getCurrentProjectData(): { name: string; records: Record<string, DailyRecord> } {
    return {
      name: this.currentProject?.name || this.currentProjectName,
      records: this.currentProject?.records || {},
    };
  }

  getProjectData(projectId: string): { name: string; records: Record<string, DailyRecord> } | null {
    const file = path.join(this.projectsDir, projectId + PROJECT_FILE_EXT);
    if (!fs.existsSync(file)) return null;
    try {
      const p = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { name: p.name || projectId, records: p.records || {} };
    } catch {
      return null;
    }
  }

  getTodayRecord(): DailyRecord | undefined {
    if (!this.currentProject) return undefined;
    return this.currentProject.records[new Date().toISOString().split('T')[0]];
  }

  getAllProjectsSummary(): Array<{ id: string; name: string; totalSeconds: number }> {
    // 重新读取索引文件，保证多窗口写入时汇总数据是最新的（文件很小，开销可忽略）
    let projects = this.index.projects;
    try {
      if (fs.existsSync(this.indexPath)) {
        const idx = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        if (idx && idx.projects) projects = idx.projects;
      }
    } catch { /* use in-memory */ }

    return Object.entries(projects)
      .map(([id, m]) => ({ id, name: m.name, totalSeconds: m.totalSeconds || 0 }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  /** 原子写入：先写临时文件再替换，避免同步/备份工具读到半个文件 */
  private writeJsonAtomic(filePath: string, data: any): void {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    try {
      fs.renameSync(tmp, filePath);
    } catch {
      try {
        fs.rmSync(filePath, { force: true });
        fs.renameSync(tmp, filePath);
      } catch {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  }
}
