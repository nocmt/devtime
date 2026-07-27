import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

export interface WorkTimeData {
  version: number;
  records: Record<string, DailyRecord>; // key = YYYY-MM-DD
}

const DATA_VERSION = 1;
const SECRET_KEY = 'worktime.password';

export class DataStore {
  private data: WorkTimeData;
  private dataPath: string;
  private secretStorage: vscode.SecretStorage;
  private password: string | null = null;

  constructor(workspaceFolder: string, secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
    this.dataPath = path.join(workspaceFolder, '.worktime', 'data.wt');
    this.data = { version: DATA_VERSION, records: {} };
  }

  /**
   * 初始化：确保 .worktime 目录存在，尝试加载数据
   */
  async init(): Promise<boolean> {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 尝试从 SecretStorage 获取密码
    this.password = (await this.secretStorage.get(SECRET_KEY)) || null;

    if (!this.password) {
      // 首次使用，需要设置密码
      return false;
    }

    // 尝试加载数据
    if (fs.existsSync(this.dataPath)) {
      try {
        await this.loadData();
        return true;
      } catch (e) {
        if ((e as Error).message === 'DECRYPT_FAILED') {
          // 密码错误
          return false;
        }
        throw e;
      }
    }

    // 数据文件不存在，正常（新项目）
    return true;
  }

  /**
   * 设置密码并保存到 SecretStorage
   */
  async setPassword(password: string): Promise<void> {
    this.password = password;
    await this.secretStorage.store(SECRET_KEY, password);

    // 如果已有数据，用新密码重新加密
    if (fs.existsSync(this.dataPath)) {
      await this.saveData();
    }
  }

  /**
   * 加载并解密数据
   */
  private async loadData(): Promise<void> {
    if (!this.password) throw new Error('No password set');

    const raw = fs.readFileSync(this.dataPath, 'utf-8');
    const encrypted: EncryptedData = JSON.parse(raw);
    const json = await decrypt(encrypted, this.password);
    this.data = JSON.parse(json);
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
    const today = new Date().toISOString().split('T')[0];

    if (!this.data.records[today]) {
      this.data.records[today] = {
        date: today,
        entries: [],
        totalSeconds: 0,
      };
    }

    this.data.records[today].entries.push(entry);
    this.data.records[today].totalSeconds += entry.duration;

    await this.saveData();
  }

  /**
   * 获取指定日期范围的记录
   */
  getRecords(startDate: string, endDate: string): DailyRecord[] {
    const records: DailyRecord[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      const dateStr = current.toISOString().split('T')[0];
      if (this.data.records[dateStr]) {
        records.push(this.data.records[dateStr]);
      }
      current.setDate(current.getDate() + 1);
    }

    return records;
  }

  /**
   * 获取今日记录
   */
  getTodayRecord(): DailyRecord | undefined {
    const today = new Date().toISOString().split('T')[0];
    return this.data.records[today];
  }

  /**
   * 获取所有数据（用于概览页面）
   */
  getAllData(): WorkTimeData {
    return this.data;
  }

  hasPassword(): boolean {
    return this.password !== null;
  }
}
