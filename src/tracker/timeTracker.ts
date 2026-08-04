import * as vscode from 'vscode';
import { IdleDetector } from './idleDetector';
import { AgentDetector, EditSource } from './agentDetector';
import { DataStore, TimeEntry } from '../storage/dataStore';
import { i18n } from '../i18n/i18n';

export class TimeTracker {
  private isTracking: boolean = false;
  private currentEntry: Partial<TimeEntry> | null = null;
  private sessionStartTime: number = 0;
  private fileViewStartTime: number = 0;
  private currentViewFile: string = '';
  private idleDetector: IdleDetector;
  private agentDetector: AgentDetector;
  private dataStore: DataStore;
  private statusBarItem: vscode.StatusBarItem;
  private updateTimer: NodeJS.Timeout | null = null;
  private lastUpdateCallback: ((elapsed: number) => void) | null = null;

  constructor(
    dataStore: DataStore,
    idleTimeout: number,
    onUpdate?: (elapsed: number) => void
  ) {
    this.dataStore = dataStore;
    this.agentDetector = new AgentDetector();
    this.lastUpdateCallback = onUpdate || null;

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'devtime.showOverview';

    this.idleDetector = new IdleDetector(idleTimeout, (idle) => {
      if (idle && this.isTracking) {
        void this.pauseTracking().catch((e) => console.error(`[DevTime] 空闲落盘失败: ${e}`));
      } else if (!idle && this.isTracking) {
        this.resumeTracking();
      }
      this.updateStatusBar();
    });
  }

  /**
   * 开始追踪
   */
  start(): void {
    this.isTracking = true;
    this.sessionStartTime = Date.now();
    this.idleDetector.start();

    // 监听文档变化，记录编辑活动
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (!this.isTracking || this.idleDetector.isIdle) return;

      const source = this.agentDetector.detectSource();
      this.recordEditActivity(e.document.fileName, source);
    });

    // 监听文件打开/切换（文件查看检测）
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!this.isTracking || this.idleDetector.isIdle) return;

      // 结束上一个文件查看
      if (this.currentViewFile) {
        this.finishFileView();
      }

      // 开始新文件查看
      if (editor) {
        this.currentViewFile = editor.document.fileName;
        this.fileViewStartTime = Date.now();
      }
    });

    // 启动状态栏更新
    this.startStatusUpdate();
    this.updateStatusBar();
  }

  /**
   * 记录编辑活动
   * 同一文件同类型的连续编辑合并到当前条目，不中断（避免每次击键都切条目/写盘）
   */
  private recordEditActivity(filePath: string, source: EditSource): void {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return;

    const relativePath = filePath.replace(workspaceFolder, '').replace(/^\//, '');

    // 同一文件、同一来源的连续编辑：沿用当前条目，不结束
    if (this.currentEntry && this.currentEntry.filePath === relativePath && this.currentEntry.type === source) {
      return;
    }

    // 换文件或来源变化：先结束上一条
    if (this.currentEntry) {
      this.finishCurrentEntry();
    }

    this.currentEntry = {
      start: new Date().toISOString(),
      type: source,
      filePath: relativePath,
    };
  }

  /**
   * 完成当前条目并保存
   */
  private async finishCurrentEntry(): Promise<void> {
    if (!this.currentEntry?.start) return;

    const now = new Date();
    const start = new Date(this.currentEntry.start);
    const duration = Math.floor((now.getTime() - start.getTime()) / 1000);

    if (duration < 1) return;

    const entry: TimeEntry = {
      start: this.currentEntry.start,
      end: now.toISOString(),
      duration,
      type: this.currentEntry.type || 'manual_edit',
      filePath: this.currentEntry.filePath,
    };

    await this.dataStore.addEntry(entry);
    this.currentEntry = null;
  }

  /**
   * 完成文件查看并保存
   */
  private async finishFileView(): Promise<void> {
    if (!this.currentViewFile || !this.fileViewStartTime) return;

    const duration = Math.floor((Date.now() - this.fileViewStartTime) / 1000);
    if (duration < 5) {
      this.currentViewFile = '';
      this.fileViewStartTime = 0;
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      this.currentViewFile = '';
      this.fileViewStartTime = 0;
      return;
    }

    const relativePath = this.currentViewFile.replace(workspaceFolder, '').replace(/^\//, '');

    await this.dataStore.addEntry({
      start: new Date(this.fileViewStartTime).toISOString(),
      end: new Date().toISOString(),
      duration,
      type: 'file_view',
      filePath: relativePath,
    });

    this.currentViewFile = '';
    this.fileViewStartTime = 0;
  }

  /**
   * 暂停追踪（空闲时）
   */
  private async pauseTracking(): Promise<void> {
    if (this.currentEntry) {
      await this.finishCurrentEntry();
    }
    if (this.currentViewFile) {
      await this.finishFileView();
    }
    // 空闲时立即落盘，避免数据停留在内存
    await this.dataStore.flushNow();
  }

  /**
   * 恢复追踪
   */
  private resumeTracking(): void {
    this.sessionStartTime = Date.now();
  }

  /**
   * 停止追踪
   */
  async stop(): Promise<void> {
    this.isTracking = false;

    if (this.currentEntry) {
      await this.finishCurrentEntry();
    }
    if (this.currentViewFile) {
      await this.finishFileView();
    }

    // 停止时立即落盘，保证所有数据写入
    await this.dataStore.flushNow();

    this.stopStatusUpdate();
    this.updateStatusBar();
  }

  /**
   * 启动状态栏定时更新
   */
  private startStatusUpdate(): void {
    this.updateTimer = setInterval(() => {
      this.updateStatusBar();
    }, 1000);
  }

  /**
   * 停止状态栏定时更新
   */
  private stopStatusUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  /**
   * 更新状态栏显示
   */
  private updateStatusBar(): void {
    if (!this.isTracking) {
      this.statusBarItem.text = i18n.t('statusBar.stopped');
    } else if (this.idleDetector.isIdle) {
      this.statusBarItem.text = i18n.t('statusBar.idle');
    } else {
      const elapsed = Math.floor((Date.now() - this.sessionStartTime) / 1000);
      const timeStr = this.formatTime(elapsed);
      this.statusBarItem.text = i18n.t('statusBar.tracking', { time: timeStr });

      // 回调通知外部更新
      if (this.lastUpdateCallback) {
        this.lastUpdateCallback(elapsed);
      }
    }

    this.statusBarItem.show();
  }

  /**
   * 格式化时间
   */
  private formatTime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  /**
   * 更新空闲超时
   */
  updateIdleTimeout(seconds: number): void {
    this.idleDetector.updateTimeout(seconds);
  }

  /**
   * 获取今日时间（秒）
   */
  getTodaySeconds(): number {
    const record = this.dataStore.getTodayRecord();
    return record?.totalSeconds || 0;
  }

  /**
   * 获取 DataStore（供 overview 使用）
   */
  getDataStore(): DataStore {
    return this.dataStore;
  }

  dispose(): void {
    void this.stop().catch((e) => console.error(`[DevTime] 停止落盘失败: ${e}`));
    this.idleDetector.dispose();
    this.statusBarItem.dispose();
    this.stopStatusUpdate();
  }
}
