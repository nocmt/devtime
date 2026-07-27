import * as vscode from 'vscode';

export class IdleDetector {
  private timeout: number; // ms
  private timer: NodeJS.Timeout | null = null;
  private _isIdle: boolean = false;
  private onIdleChange: (idle: boolean) => void;

  constructor(timeoutSeconds: number, onIdleChange: (idle: boolean) => void) {
    this.timeout = timeoutSeconds * 1000;
    this.onIdleChange = onIdleChange;
  }

  get isIdle(): boolean {
    return this._isIdle;
  }

  /**
   * 开始监听用户活动
   */
  start(): void {
    // 监听编辑器文本变化
    vscode.workspace.onDidChangeTextDocument(() => this.resetTimer());

    // 监听编辑器切换
    vscode.window.onDidChangeActiveTextEditor(() => this.resetTimer());

    // 监听终端活动
    vscode.window.onDidOpenTerminal(() => this.resetTimer());
    vscode.window.onDidCloseTerminal(() => this.resetTimer());

    // 监听焦点变化
    vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) {
        this.resetTimer();
      }
    });

    // 启动初始计时器
    this.resetTimer();
  }

  /**
   * 重置空闲计时器
   */
  private resetTimer(): void {
    if (this._isIdle) {
      this._isIdle = false;
      this.onIdleChange(false);
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this._isIdle = true;
      this.onIdleChange(true);
    }, this.timeout);
  }

  /**
   * 更新超时时间
   */
  updateTimeout(seconds: number): void {
    this.timeout = seconds * 1000;
    this.resetTimer();
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }
}
