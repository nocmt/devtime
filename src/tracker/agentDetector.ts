import * as vscode from 'vscode';

export type EditSource = 'manual_edit' | 'agent_edit';

export class AgentDetector {
  private editorFocused: boolean = true;
  private lastUserActivity: number = Date.now();

  constructor() {
    // 追踪编辑器焦点
    vscode.window.onDidChangeActiveTextEditor(() => {
      this.editorFocused = true;
      this.lastUserActivity = Date.now();
    });

    vscode.window.onDidChangeWindowState((e) => {
      this.editorFocused = e.focused;
      if (e.focused) {
        this.lastUserActivity = Date.now();
      }
    });
  }

  /**
   * 判断编辑来源
   * 如果编辑器无焦点，或用户超过 2 秒没有活动，则认为是 Agent 修改
   */
  detectSource(): EditSource {
    // 如果编辑器没有焦点，一定是外部/Agent 修改
    if (!this.editorFocused) {
      return 'agent_edit';
    }

    // 有焦点 + 最近有活动 = 手动编辑
    return 'manual_edit';
  }

  /**
   * 标记用户活动（由 IdleDetector 调用）
   */
  markUserActivity(): void {
    this.lastUserActivity = Date.now();
  }
}
