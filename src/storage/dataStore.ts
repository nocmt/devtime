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

const DATA_VERSION = 3;
const PROJECTS_DIR = 'projects';
const OLD_DATA_FILE = 'devtime-data.json';
const PROJECT_FILE_EXT = '.json';

/**
 * DataStore v3（分片版）：
 * - 每台设备只写自己的分片文件：<dataRoot>/projects/<projectId>.<deviceId>.json
 * - 读取时合并该项目所有分片（<projectId>.json 旧版单文件也兼容并入）
 * - 多设备同时编辑同一项目：各写各的分片，永不互相覆盖，云同步无文件冲突
 * - 汇总动态扫描目录，不再共享写入索引文件，避免索引写冲突
 * - 全部异步 IO；内存优先 + 最小落盘间隔（默认 30 分钟）减少磁盘写入
 */
export class DataStore {
  private dataRoot: string;
  private projectsDir: string;
  private currentProjectId: string | null = null;
  private currentProjectName: string;
  private currentProjectPath: string;
  private deviceId: string;
  /** 本设备产生的数据（写盘内容 = 本设备分片） */
  private localRecords: Record<string, DailyRecord> = {};
  /** 合并视图：所有分片合并后的当前项目数据（读取/展示用） */
  private currentProject: ProjectData | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private configuredStoragePath?: string;
  private fallbackUsed = false;
  private fallbackReason = '';
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private lastSaveTime = 0;
  private readonly saveIntervalMs: number;

  constructor(
    workspaceFolder: string,
    storagePath?: string,
    saveIntervalMs: number = 30 * 60 * 1000,
    deviceId?: string
  ) {
    this.currentProjectName = path.basename(workspaceFolder);
    this.currentProjectPath = workspaceFolder;
    this.currentProjectId = this.sanitizeProjectId(this.currentProjectName);
    this.configuredStoragePath = storagePath;
    this.saveIntervalMs = saveIntervalMs;
    this.deviceId = deviceId || `${os.hostname()}_${Math.random().toString(36).slice(2, 8)}`;
    this.applyDataRoot(this.resolveDataRoot());
  }

  /** 平台默认数据根目录：macOS → ~/Library/devtime，Windows/其他 → ~/devtime */
  private defaultDataRoot(): string {
    if (process.platform === 'darwin') {
      return path.join(os.homedir(), 'Library', 'devtime');
    }
    return path.join(os.homedir(), 'devtime');
  }

  /**
   * 解析数据根目录：
   * - 默认：macOS ~/Library/devtime / Windows ~/devtime（不用点开头目录避免云盘同步忽略隐藏文件）
   * - 自定义目录：若所选目录名本身就是 devtime 则直接用；否则在其中创建 devtime 子目录
   * - Windows 上检测到 Unix/Mac 风格绝对路径（如 /Users/xxx）时视为无效配置，回退默认
   */
  private resolveDataRoot(): string {
    if (this.configuredStoragePath && this.configuredStoragePath.trim()) {
      const raw = this.configuredStoragePath.trim();
      if (process.platform === 'win32' && raw.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(raw)) {
        this.fallbackReason = `存储路径 "${raw}" 不是 Windows 路径（可能是从 Mac/Linux 同步的配置）`;
        return this.defaultDataRoot();
      }
      const p = path.resolve(raw);
      return path.basename(p) === 'devtime' ? p : path.join(p, 'devtime');
    }
    return this.defaultDataRoot();
  }

  /**
   * 旧版数据根目录候选（用于升级迁移）：
   * - 自定义目录：<目录>/.devtime
   * - 默认目录：~/.devtime 与 ~/devtime（两个历史版本都迁移到平台默认目录）
   */
  private legacyDataRoots(): string[] {
    if (this.configuredStoragePath && this.configuredStoragePath.trim()) {
      const p = path.resolve(this.configuredStoragePath.trim());
      return [path.basename(p) === '.devtime' ? p : path.join(p, '.devtime')];
    }
    return [path.join(os.homedir(), 'devtime'), path.join(os.homedir(), '.devtime')];
  }

  /** 新目录不存在且旧目录存在时，自动迁移（rename），避免升级丢数据 */
  private async migrateOldDataRootIfNeeded(): Promise<void> {
    if (await this.fileExists(this.dataRoot)) return;
    for (const old of this.legacyDataRoots()) {
      if (old === this.dataRoot) continue;
      if (!await this.fileExists(old)) continue;
      try {
        await fsp.rename(old, this.dataRoot);
      } catch (e) {
        console.error(`[DevTime] 迁移旧数据目录 ${old} → ${this.dataRoot} 失败: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
  }

  private applyDataRoot(root: string): void {
    this.dataRoot = root;
    this.projectsDir = path.join(root, PROJECTS_DIR);
  }

  private sanitizeProjectId(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').toLowerCase();
  }

  getProjectId(): string { return this.currentProjectId!; }
  getProjectName(): string { return this.currentProjectName; }
  getDeviceId(): string { return this.deviceId; }

  /** 数据根目录（用于 UI 展示） */
  getStoragePath(): string { return this.dataRoot; }

  /** 配置的存储路径是否被回退到默认目录 */
  wasFallbackUsed(): boolean { return this.fallbackUsed; }

  /** 回退原因（用于提示用户） */
  getFallbackReason(): string { return this.fallbackReason; }

  /** 当前项目本设备分片文件路径 */
  getProjectDataPath(): string {
    return path.join(this.projectsDir, this.projectFileName(this.currentProjectId!));
  }

  private projectFileName(projectId: string): string {
    return `${projectId}.${this.deviceId}${PROJECT_FILE_EXT}`;
  }

  /** 某项目的所有分片文件（含旧版无设备后缀 <id>.json），按文件名排序保证稳定 */
  private async listProjectFiles(projectId: string): Promise<string[]> {
    let files: string[] = [];
    try {
      files = (await fsp.readdir(this.projectsDir)).filter(f => f.endsWith(PROJECT_FILE_EXT));
    } catch {
      return [];
    }
    return files
      .filter(f => f === `${projectId}${PROJECT_FILE_EXT}` || f.startsWith(`${projectId}.`))
      .sort();
  }

  /** 从分片文件名提取 projectId（projectId 不含点，取第一个点前） */
  private projectIdFromFile(fileName: string): string {
    return fileName.split('.')[0];
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
      this.applyDataRoot(this.defaultDataRoot());
      await fsp.mkdir(this.dataRoot, { recursive: true });
      await fsp.mkdir(this.projectsDir, { recursive: true });
    }

    await this.migrateLegacyIfNeeded();
    await this.loadCurrentProject();

    // 首次运行/新项目时，确保本设备分片存在
    await this.saveData();
    this.lastSaveTime = Date.now();
  }

  /**
   * 迁移旧版单一聚合文件 devtime-data.json（v1/v2）→ 按项目拆分
   * 拆出的数据写入本设备分片；原文件保留为 devtime-data.json.migrated 备份
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
      // 只写入本设备分片，不覆盖其他设备可能已写的分片
      const target = this.projectFileName(id);
      if (!await this.fileExists(path.join(this.projectsDir, target))) {
        await this.writeJsonAtomic(path.join(this.projectsDir, target), {
          version: DATA_VERSION,
          name: p.name,
          displayPath: p.displayPath,
          records: p.records,
        });
      }
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

  /** 加载当前项目：合并所有分片到合并视图，本设备分片单独存 localRecords */
  private async loadCurrentProject(): Promise<void> {
    if (!this.currentProjectId) return;
    const files = await this.listProjectFiles(this.currentProjectId);
    this.localRecords = {};
    const merged: Record<string, DailyRecord> = {};
    let name = this.currentProjectName;
    let displayPath = this.currentProjectPath;

    for (const f of files) {
      try {
        const p = JSON.parse(await fsp.readFile(path.join(this.projectsDir, f), 'utf-8'));
        if (p.name) name = p.name;
        if (p.displayPath) displayPath = p.displayPath;
        if (f === this.projectFileName(this.currentProjectId)) {
          this.localRecords = p.records || {};
        }
        Object.assign(merged, this.mergeRecords(merged, p.records || {}));
      } catch { /* ignore corrupted file */ }
    }

    this.currentProject = { name, displayPath, records: merged };
  }

  private sumRecords(records: Record<string, DailyRecord> | undefined): number {
    if (!records) return 0;
    return Object.values(records).reduce((s, r) => s + (r?.totalSeconds || 0), 0);
  }

  /** 只写本设备分片文件（不写共享索引），串行队列防止并发写冲突 */
  async saveData(): Promise<void> {
    if (!this.currentProjectId) return;
    const file = this.getProjectDataPath();
    const localData = this.localRecords;
    const name = this.currentProject?.name || this.currentProjectName;
    const displayPath = this.currentProject?.displayPath || this.currentProjectPath;

    return this.enqueueWrite(async () => {
      await this.writeJsonAtomic(file, {
        version: DATA_VERSION,
        name,
        displayPath,
        records: localData,
      });
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

    // 本设备分片
    if (!this.localRecords[today]) {
      this.localRecords[today] = { date: today, entries: [], totalSeconds: 0 };
    }
    this.localRecords[today].entries.push(entry);
    this.localRecords[today].totalSeconds += entry.duration;

    // 合并视图（读取/展示用）
    if (!this.currentProject.records[today]) {
      this.currentProject.records[today] = { date: today, entries: [], totalSeconds: 0 };
    }
    this.currentProject.records[today].entries.push(entry);
    this.currentProject.records[today].totalSeconds += entry.duration;

    // 只更新内存，按最小间隔（默认 30 分钟）落盘，减少磁盘写入
    this.scheduleSave();
  }

  /**
   * 计划落盘：距离上次落盘不足最小间隔时，仅标记脏并推迟；
   * 到达间隔后有变化才真正写入。高频写入不会频繁触发磁盘 IO。
   */
  private scheduleSave(): void {
    this.dirty = true;
    const now = Date.now();
    const elapsed = now - this.lastSaveTime;
    if (elapsed >= this.saveIntervalMs) {
      // 已到最小间隔：立即落盘
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      void this.doFlush().catch((e) => console.error(`[DevTime] 落盘失败: ${e instanceof Error ? e.message : String(e)}`));
      return;
    }
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.doFlush().catch((e) => console.error(`[DevTime] 落盘失败: ${e instanceof Error ? e.message : String(e)}`));
      }, this.saveIntervalMs - elapsed);
    }
  }

  /** 实际写盘：仅当有未落盘变化时写入（分片写入天然无设备间覆盖问题） */
  private async doFlush(): Promise<void> {
    if (!this.dirty) return;
    await this.saveData();
    this.dirty = false;
    this.lastSaveTime = Date.now();
  }

  /** 立即落盘（供停止计时/关闭窗口/打开概览时调用，保证数据不丢） */
  async flushNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.doFlush();
  }

  getCurrentProjectData(): { name: string; records: Record<string, DailyRecord> } {
    return {
      name: this.currentProject?.name || this.currentProjectName,
      records: this.currentProject?.records || {},
    };
  }

  /** 读取某项目：合并其全部分片 */
  async getProjectData(projectId: string): Promise<{ name: string; records: Record<string, DailyRecord> } | null> {
    const files = await this.listProjectFiles(projectId);
    if (files.length === 0) return null;
    let records: Record<string, DailyRecord> = {};
    let name = projectId;
    for (const f of files) {
      try {
        const p = JSON.parse(await fsp.readFile(path.join(this.projectsDir, f), 'utf-8'));
        if (p.name) name = p.name;
        records = this.mergeRecords(records, p.records || {});
      } catch { /* ignore */ }
    }
    return { name, records };
  }

  getTodayRecord(): DailyRecord | undefined {
    if (!this.currentProject) return undefined;
    return this.currentProject.records[new Date().toISOString().split('T')[0]];
  }

  /** 汇总：动态扫描目录，对每个项目合并所有分片求总时长（不再依赖共享索引） */
  async getAllProjectsSummary(): Promise<Array<{ id: string; name: string; totalSeconds: number }>> {
    let files: string[] = [];
    try {
      files = (await fsp.readdir(this.projectsDir)).filter(f => f.endsWith(PROJECT_FILE_EXT));
    } catch {
      return [];
    }

    const map = new Map<string, { name: string; totalSeconds: number }>();
    for (const f of files) {
      const id = this.projectIdFromFile(f);
      if (!id) continue;
      try {
        const p = JSON.parse(await fsp.readFile(path.join(this.projectsDir, f), 'utf-8'));
        const total = this.sumRecords(p.records);
        const cur = map.get(id);
        if (cur) {
          cur.totalSeconds += total;
          if (p.name) cur.name = p.name;
        } else {
          map.set(id, { name: p.name || id, totalSeconds: total });
        }
      } catch { /* ignore corrupted file */ }
    }

    return Array.from(map.entries())
      .map(([id, m]) => ({ id, name: m.name, totalSeconds: m.totalSeconds }))
      .sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  /** 按日期合并两条记录，条目按 key 去重取并集，totalSeconds 重算 */
  private mergeRecords(
    a: Record<string, DailyRecord>,
    b: Record<string, DailyRecord>
  ): Record<string, DailyRecord> {
    const result: Record<string, DailyRecord> = { ...a };
    for (const [date, dayB] of Object.entries(b)) {
      const dayA = result[date];
      if (!dayA) {
        result[date] = dayB;
        continue;
      }
      const map = new Map<string, TimeEntry>();
      for (const e of dayA.entries) map.set(this.entryKey(e), e);
      for (const e of dayB.entries) map.set(this.entryKey(e), e);
      const entries = Array.from(map.values()).sort((x, y) => x.start.localeCompare(y.start));
      result[date] = {
        date,
        entries,
        totalSeconds: entries.reduce((s, e) => s + e.duration, 0),
      };
    }
    return result;
  }

  private entryKey(e: TimeEntry): string {
    return `${e.start}|${e.type}|${e.filePath || ''}`;
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
