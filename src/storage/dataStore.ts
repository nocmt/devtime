import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { encrypt, decrypt, EncryptedData } from './crypto';

export interface TimeEntry {
  start: string;        // ISO timestamp
  end: string;          // ISO timestamp
  duration: number;     // seconds
  type: 'manual_edit' | 'agent_edit' | 'file_view';
  filePath?: string;    // 相对路径
}

export interface DailyRecord {
  date: string;         // YYYY-MM-DD
  entries: TimeEntry[];
  totalSeconds: number;
}

export interface ProjectData {
  name: string;         // 项目名（文件夹名）
  displayPath: string;  // 最后一次打开时的完整路径
  records: Record<string, DailyRecord>; // key = YYYY-MM-DD
}

export interface WorkTimeData {
  version: number;
  projects: Record<string, ProjectData>; // key = projectId (文件夹名)
}

const DATA_VERSION = 2;
const SECRET_KEY = 'worktime.password';

export class DataStore {
  private data: WorkTimeData;
  private dataPath: string;
  private secretStorage: vscode.SecretStorage;
  private password: string | null = null;
  private currentProjectId: string | null = null;
  private currentProjectName: string;
  private currentProjectPath: string;

  constructor(workspaceFolder: string, secretStorage: vscode.SecretStorage, storagePath?: string) {
    this.secretStorage = secretStorage;
    this.currentProjectName = path.basename(workspaceFolder);
    this.currentProjectPath = workspaceFolder;
    this.currentProjectId = this.sanitizeProjectId(this.currentProjectName);

    // 决定存储路径
    if (storagePath && storagePath.trim()) {
      // 用户自定义路径
      const dir = storagePath.trim();
      this.dataPath = path.join(dir, 'worktime-data.wt');
    } else {
      // 默认：用户 home 目录下的 .worktime/
      this.dataPath = path.join(os.homedir(), '.worktime', 'worktime-data.wt');
    }

    this.data = { version: DATA_VERSION, projects: {} };
  }

  /**
   * 清理项目 ID（避免路径中特殊字符）
   */
  private sanitizeProjectId(name: string): string {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').toLowerCase();
  }

  /**
   * 获取当前项目 ID
   */
  getProjectId(): string {
    return this.currentProjectId!;
  }

  /**
   * 获取当前项目名
   */
  getProjectName(): string {
    return this.currentProjectName;
  }

  /**
   * 初始化：确保目录存在，尝试加载数据
   */
  async init(): Promise<boolean> {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 尝试从 SecretStorage 获取密码
    this.password = (await this.secretStorage.get(SECRET_KEY)) || null;

    if (!this.password) {
      return false;
    }

    // 尝试加载数据
    if (fs.existsSync(this.dataPath)) {
      try {
        await this.loadData();
        // 确保当前项目在数据中
        this.ensureProject();
        return true;
      } catch (e) {
        if ((e as Error).message === 'DECRYPT_FAILED') {
          return false;
        }
        throw e;
      }
    }

    // 数据文件不存在，新用户
    this.ensureProject();
    return true;
  }

  /**
   * 确保当前项目存在于数据中
   */
  private ensureProject(): void {
    if (!this.currentProjectId) return;

    if (!this.data.projects[this.currentProjectId]) {
      this.data.projects[this.currentProjectId] = {
        name: this.currentProjectName,
        displayPath: this.currentProjectPath,
        records: {},
      };
    } else {
      // 更新 displayPath
      this.data.projects[this.currentProjectId].displayPath = this.currentProjectPath;
    }
  }

  /**
   * 首次设置密码（初始化场景）
   */
  async setPassword(password: string): Promise<void> {
    this.password = password;
    await this.secretStorage.store(SECRET_KEY, password);
    if (fs.existsSync(this.dataPath)) {
      await this.saveData();
    } else {
      this.ensureProject();
      await this.saveData();
    }
  }

  /**
   * 正常换密码：先验证旧密码，数据原封不动重新加密
   * @returns true 成功，false 旧密码错误
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    if (fs.existsSync(this.dataPath)) {
      try {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const encrypted: EncryptedData = JSON.parse(raw);
        await decrypt(encrypted, oldPassword);
      } catch {
        return false;
      }
    }
    this.password = newPassword;
    await this.secretStorage.store(SECRET_KEY, newPassword);
    await this.saveData();
    return true;
  }

  /**
   * 清空数据并设新密码（密码错误、文件不属于当前用户时使用）
   */
  async resetData(newPassword: string): Promise<void> {
    this.password = newPassword;
    await this.secretStorage.store(SECRET_KEY, newPassword);
    this.data = { version: DATA_VERSION, projects: {} };
    this.ensureProject();
    await this.saveData();
  }

  /**
   * 加载并解密数据
   */
  private async loadData(): Promise<void> {
    if (!this.password) throw new Error('No password set');

    const raw = fs.readFileSync(this.dataPath, 'utf-8');
    const encrypted: EncryptedData = JSON.parse(raw);
    const json = await decrypt(encrypted, this.password);
    const loaded = JSON.parse(json);

    // 兼容 v1 数据格式（升级迁移）
    if (loaded.version === 1 && loaded.records) {
      // 旧格式：单个项目的 records，迁移到新格式
      const oldName = this.currentProjectName;
      this.data = {
        version: DATA_VERSION,
        projects: {
          [this.sanitizeProjectId(oldName)]: {
            name: oldName,
            displayPath: this.currentProjectPath,
            records: loaded.records,
          }
        }
      };
      await this.saveData();
    } else {
      this.data = loaded;
    }
  }

  /**
   * 加密并保存数据
   */
  async saveData(): Promise<void> {
    if (!this.password) throw new Error('No password set');

    const json = JSON.stringify(this.data, null, 2);
    const encrypted = await encrypt(json, this.password);
    fs.writeFileSync(this.dataPath, JSON.stringify(encrypted, null, 2), 'utf-8');
  }

  /**
   * 添加时间条目
   */
  async addEntry(entry: TimeEntry): Promise<void> {
    if (!this.currentProjectId) return;
    this.ensureProject();

    const today = new Date().toISOString().split('T')[0];
    const project = this.data.projects[this.currentProjectId];

    if (!project.records[today]) {
      project.records[today] = {
        date: today,
        entries: [],
        totalSeconds: 0,
      };
    }

    project.records[today].entries.push(entry);
    project.records[today].totalSeconds += entry.duration;

    await this.saveData();
  }

  /**
   * 获取当前项目的指定日期范围记录
   */
  getRecords(startDate: string, endDate: string): DailyRecord[] {
    if (!this.currentProjectId) return [];
    const project = this.data.projects[this.currentProjectId];
    if (!project) return [];

    const records: DailyRecord[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      if (project.records[dateStr]) {
        records.push(project.records[dateStr]);
      }
      current.setDate(current.getDate() + 1);
    }

    return records;
  }

  /**
   * 获取当前项目今日记录
   */
  getTodayRecord(): DailyRecord | undefined {
    if (!this.currentProjectId) return undefined;
    const today = new Date().toISOString().split('T')[0];
    return this.data.projects[this.currentProjectId]?.records[today];
  }

  /**
   * 获取当前项目的所有数据
   */
  getCurrentProjectData(): { name: string; records: Record<string, DailyRecord> } {
    if (!this.currentProjectId || !this.data.projects[this.currentProjectId]) {
      return { name: this.currentProjectName, records: {} };
    }
    const p = this.data.projects[this.currentProjectId];
    return { name: p.name, records: p.records };
  }

  /**
   * 获取指定项目的数据（用于切换查看其他项目）
   */
  getProjectData(projectId: string): { name: string; records: Record<string, DailyRecord> } | null {
    const p = this.data.projects[projectId];
    if (!p) return null;
    return { name: p.name, records: p.records };
  }

  /**
   * 获取所有项目汇总数据
   */
  getAllProjectsSummary(): Array<{ id: string; name: string; totalSeconds: number }> {
    return Object.entries(this.data.projects).map(([id, p]) => ({
      id,
      name: p.name,
      totalSeconds: Object.values(p.records).reduce((sum, r) => sum + r.totalSeconds, 0),
    })).sort((a, b) => b.totalSeconds - a.totalSeconds);
  }

  /**
   * 尝试用给定密码解密数据（密码重试用）
   * @returns true 解密成功，false 密码错误
   */
  async tryDecrypt(password: string): Promise<boolean> {
    if (!fs.existsSync(this.dataPath)) return true;
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf-8');
      const encrypted: EncryptedData = JSON.parse(raw);
      await decrypt(encrypted, password);
      // 成功，保存到 SecretStorage
      this.password = password;
      await this.secretStorage.store(SECRET_KEY, password);
      await this.loadData();
      this.ensureProject();
      return true;
    } catch {
      return false;
    }
  }

  hasPassword(): boolean {
    return this.password !== null;
  }

  /**
   * 获取存储文件路径（用于提示用户）
   */
  getStoragePath(): string {
    return this.dataPath;
  }
}
