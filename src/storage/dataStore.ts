import { promises as fsp } from 'fs';
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
 * - 全部使用异步 IO（fs/promises），避免 Windows 网络盘/主目录不可达时同步阻塞导致"一直激活中"
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
  private writeQueue: Promise<void> = Promise.resolve();
  private configuredStoragePath?: string;
  private fallbackUsed = false;
  private fallbackReason = '';

  constructor(workspaceFolder: string, storagePath?: string) {
    this.currentProjectName = path.basename(workspaceFolder);
    this.currentProjectPath = workspaceFolder;
    this.currentProjectId = this.sanitizeProjectId(this.currentProjectName);
    this.configuredStoragePath = storagePath;
    this.applyDataRoot(this.resolveDataRoot());
  }

  /**
   * 解析数据根目录：
   * - 默认：~/devtime（不用点开头目录，避免云盘同步忽略隐藏文件）
   * - 自定义目录：若所选目录名本身就是 devtime 则直接用；否则在其中创建 devtime 子目录
   * - Windows 上检测到 Unix/Mac 风格绝对路径（如 /Users/xxx）时视为无效配置，回退默认
   */
  private resolveDataRoot(): string {
    if (this.configuredStoragePath && this.configuredStoragePath.trim()) {
      const raw = this.configuredStoragePath.trim();
      if (process.platform === 'win32' && raw.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(raw)) {
        this.fallbackReason = `存储路径 "${raw}" 不是 Windows 路径（可能是从 Mac/Linux 同步的配置）`;
        return path.join(os.homedir(), 'devtime');
      }
      const p = path.resolve(raw);
      return path.basename(p) === 'devtime' ? p : path.join(p, 'devtime');
    }
    return path.join(os.homedir(), 'devtime');
  }

  /**
   * 旧版（v3 之前）数据根目录：~/.devtime 或 <自定义目录>/.devtime
   * 用于升级时把已有数据自动迁移到新目录 devtime
   */
  private legacyDataRoot(): string {
    if (this.configuredStoragePath && this.configuredStoragePath.trim()) {
      const p = path.resolve(this.configuredStoragePath.trim());
      return path.basename(p) === '.devtime' ? p : path.join(p, '.devtime');
    }
    return path.join(os.homedir(), '.devtime');
  }

  /** 新目录不存在且旧 .devtime 目录存在时，自动迁移（rename），避免升级丢数据 */
  private async migrateOldDataRootIfNeeded(): Promise<void> {
    if (await this.fileExists(this.dataRoot)) return;
    const old = this.legacyDataRoot();
    if (old === this.dataRoot) return;
    if (!await this.fileExists(old)) return;
    try {
      await fsp.rename(old, this.dataRoot);
    } catch (e) {
      console.error(`[DevTime] 迁移旧数据目录 ${old} → ${this.dataRoot} 失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private applyDataRoot(root: string): void {
    this.dataRoot = root;
    this.projectsDir = path.join(root, PROJECTS_DIR);
    this.indexPath = path.join(root, INDEX_FILE);
  }

  private sanitizeProjectId(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').toLowerCase();
  }

  getProjectId(): string { return this.currentProjectId!; }
  getProjectName(): string { return this.currentProjectName; }

  /** 数据根目录（用于 UI 展示） */
  getStoragePath(): string { return this.dataRoot; }

  /** 配置的存储路径是否被回退到默认目录 */
  wasFallbackUsed(): boolean { return this.fallbackUsed; }

  /** 回退原因（用于提示用户） */
  getFallbackReason(): string { return this.fallbackReason; }

  /** 当前项目的数据文件路径 */
  getProjectDataPath(): string {
    return path.join(this.projectsDir, this.currentProjectId + PROJECT_FILE_EXT);
  }

  async init(): Promise<void> {
    // 重新解析数据根目录（可能因跨平台无效路径直接回退默认）
    const resolved = this.resolveDataRoot();
    if (resolved !== this.dataRoot) {
      this.applyDataRoot(resolved);
    }
    // resolve 阶段已判定配置路径无效（如 Windows 上的 Mac 路径）→ 标记回退
    if (this.fallbackReason && !this.fallbackUsed) {
      this.fallbackUsed = true;
    }

    // 旧版 .devtime 目录升级迁移（新目录不存在时自动 rename）
    await this.migrateOldDataRootIfNeeded();

    // 创建目录；配置路径不可用（权限/网络盘等）时回退默认目录，避免激活失败
    try {
      await fsp.mkdir(this.dataRoot, { recursive: true });
      await fsp.mkdir(this.projectsDir, { recursive: true });
    } catch (e) {
      if (!this.fallbackReason) {
        this.fallbackReason = `无法创建存储目录 ${this.dataRoot}: ${e instanceof Error ? e.message : String(e)}`;
      }
      this.fallbackUsed = true;
      this.applyDataRoot(path.join(os.homedir(), 'devtime'));
      await fsp.mkdir(this.dataRoot, { recursive: true });
      await fsp.mkdir(this.projectsDir, { recursive: true });
    }

    await this.migrateLegacyIfNeeded();
    await this.loadIndex();
    await this.loadCurrentProject();

    // 首次运行/新项目时，落盘当前项目文件与索引
    await this.saveData();
  }

  /**
   * 迁移旧版单一聚合文件 devtime-data.json（v1/v2）→ 按项目拆分
   * 迁移完成后原文件保留为 devtime-data.json.migrated 备份，避免重复迁移
   */
  private async migrateLegacyIfNeeded(): Promise<void> {
    let legacyPath = path.join(this.dataRoot, OLD_DATA_FILE);
    if (!await this.fileExists(legacyPath)) {
      // 自定义目录场景下，旧文件可能位于所选目录（dataRoot 的父目录）而非 devtime 子目录内
      const alt = path.join(path.dirname(this.dataRoot), OLD_DATA_FILE);
      if (path.basename(this.dataRoot) === 'devtime' && await this.fileExists(alt)) {
        legacyPath = alt;
      } else {
        return;
      }
    }

    let loaded: any;
    try {
      loaded = JSON.parse(await fsp.readFile(legacyPath, 'utf-8'));
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
      await this.writeJsonAtomic(path.join(this.projectsDir, id + PROJECT_FILE_EXT), {
        version: DATA_VERSION,
        name: p.name,
        displayPath: p.displayPath,
        records: p.records,
      });
    }

    // 备份旧文件并移除原始文件，防止重复迁移
    const backup = path.join(this.dataRoot, OLD_DATA_FILE + '.migrated');
    try {
      if (await this.fileExists(backup)) await fsp.rm(backup, { force: true });
      await fsp.rename(legacyPath, backup);
    } catch {
      try { await fsp.rm(legacyPath, { force: true }); } catch { /* ignore */ }
    }
  }

  /** 加载索引；若不存在则扫描 projects 目录重建 */
  private async loadIndex(): Promise<void> {
    if (await this.fileExists(this.indexPath)) {
      try {
        const idx = JSON.parse(await fsp.readFile(this.indexPath, 'utf-8'));
        if (idx && idx.projects) {
          this.index = { version: DATA_VERSION, projects: idx.projects };
          return;
        }
      } catch { /* fall through to scan */ }
    }

    this.index = { version: DATA_VERSION, projects: {} };
    let files: string[] = [];
    try { files = (await fsp.readdir(this.projectsDir)).filter(f => f.endsWith(PROJECT_FILE_EXT)); } catch { return; }
    for (const f of files) {
      const id = f.slice(0, -PROJECT_FILE_EXT.length);
      try {
        const p = JSON.parse(await fsp.readFile(path.join(this.projectsDir, f), 'utf-8'));
        this.index.projects[id] = {
          name: p.name || id,
          displayPath: p.displayPath || '',
          totalSeconds: this.sumRecords(p.records),
        };
      } catch { /* ignore corrupted file */ }
    }
  }

  private async loadCurrentProject(): Promise<void> {
    if (!this.currentProjectId) return;
    if (await this.fileExists(this.getProjectDataPath())) {
      try {
        const p = JSON.parse(await fsp.readFile(this.getProjectDataPath(), 'utf-8'));
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

  /** 只写当前项目文件 + 轻量索引，实现增量更新；串行队列防止并发写冲突 */
  async saveData(): Promise<void> {
    if (!this.currentProjectId || !this.currentProject) return;

    this.index.projects[this.currentProjectId] = {
      name: this.currentProject.name,
      displayPath: this.currentProject.displayPath,
      totalSeconds: this.sumRecords(this.currentProject.records),
    };

    const projectFile = this.getProjectDataPath();
    const indexData = this.index;

    return this.enqueueWrite(async () => {
      await this.writeJsonAtomic(projectFile, {
        version: DATA_VERSION,
        name: this.currentProject!.name,
        displayPath: this.currentProject!.displayPath,
        records: this.currentProject!.records,
      });
      await this.writeJsonAtomic(this.indexPath, indexData);
    });
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const p = this.writeQueue.then(task, task);
    this.writeQueue = p.catch(() => { /* 错误由调用方处理 */ });
    return p;
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

  async getProjectData(projectId: string): Promise<{ name: string; records: Record<string, DailyRecord> } | null> {
    const file = path.join(this.projectsDir, projectId + PROJECT_FILE_EXT);
    if (!await this.fileExists(file)) return null;
    try {
      const p = JSON.parse(await fsp.readFile(file, 'utf-8'));
      return { name: p.name || projectId, records: p.records || {} };
    } catch {
      return null;
    }
  }

  getTodayRecord(): DailyRecord | undefined {
    if (!this.currentProject) return undefined;
    return this.currentProject.records[new Date().toISOString().split('T')[0]];
  }

  async getAllProjectsSummary(): Promise<Array<{ id: string; name: string; totalSeconds: number }>> {
    // 重新读取索引文件，保证多窗口写入时汇总数据是最新的（文件很小，开销可忽略）
    let projects = this.index.projects;
    try {
      if (await this.fileExists(this.indexPath)) {
        const idx = JSON.parse(await fsp.readFile(this.indexPath, 'utf-8'));
        if (idx && idx.projects) projects = idx.projects;
      }
    } catch { /* use in-memory */ }

    return Object.entries(projects)
      .map(([id, m]) => ({ id, name: m.name, totalSeconds: m.totalSeconds || 0 }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fsp.access(p);
      return true;
    } catch {
      return false;
    }
  }

  /** 原子写入：先写临时文件再替换，避免同步/备份工具读到半个文件 */
  private async writeJsonAtomic(filePath: string, data: any): Promise<void> {
    const tmp = filePath + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    try {
      await fsp.rename(tmp, filePath);
    } catch {
      try {
        await fsp.rm(filePath, { force: true });
        await fsp.rename(tmp, filePath);
      } catch {
        await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
      }
    }
  }
}
