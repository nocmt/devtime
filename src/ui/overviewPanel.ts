import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DataStore } from '../storage/dataStore';

export class OverviewPanel {
  private panel: vscode.WebviewPanel | undefined;
  private dataStore: DataStore;
  private extensionPath: string;
  private selectedProjectId: string | null = null;

  constructor(dataStore: DataStore, extensionPath: string) {
    this.dataStore = dataStore;
    this.extensionPath = extensionPath;
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      this.sendDataToWebview();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'devtimeOverview',
      'DevTime',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(this.extensionPath, 'src', 'ui', 'webview'))
        ]
      }
    );

    this.panel.webview.html = this.getHtml();

    this.panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'getData':
          this.sendDataToWebview();
          break;
        case 'changePassword':
          await this.handleChangePassword();
          break;
        case 'switchProject':
          this.selectedProjectId = message.projectId;
          this.sendDataToWebview();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  refresh(): void {
    this.sendDataToWebview();
  }

  private sendDataToWebview(): void {
    if (!this.panel) return;

    const config = vscode.workspace.getConfiguration('devtime');
    const hourlyRate = config.get<number>('hourlyRate', 100);
    const currency = config.get<string>('currency', '¥');
    const allProjects = this.dataStore.getAllProjectsSummary();

    // 默认选当前项目
    const activeId = this.selectedProjectId || this.dataStore.getProjectId();

    let records: Record<string, any> = {};
    let projectName = '';

    const projectData = this.selectedProjectId
      ? this.dataStore.getProjectData(this.selectedProjectId)
      : this.dataStore.getCurrentProjectData();

    if (projectData) {
      records = projectData.records;
      projectName = projectData.name;
    }

    this.panel.webview.postMessage({
      type: 'updateData',
      data: {
        activeProjectId: activeId,
        allProjects,
        hasPassword: this.dataStore.hasPassword(),
        projectName,
        records,
        hourlyRate,
        currency,
        storagePath: this.dataStore.getStoragePath(),
      }
    });
  }

  private async handleChangePassword(): Promise<void> {
    const oldPassword = await vscode.window.showInputBox({
      prompt: '请输入当前密码',
      password: true,
    });
    if (!oldPassword) return;

    const newPassword = await vscode.window.showInputBox({
      prompt: '请输入新密码',
      password: true,
    });
    if (!newPassword) return;

    const newConfirm = await vscode.window.showInputBox({
      prompt: '请再次输入新密码确认',
      password: true,
    });
    if (newPassword !== newConfirm) {
      vscode.window.showErrorMessage('两次密码不一致');
      return;
    }

    const ok = await this.dataStore.changePassword(oldPassword, newPassword);
    if (ok) {
      vscode.window.showInformationMessage('密码已更新，数据已用新密码重新加密');
    } else {
      vscode.window.showErrorMessage('当前密码错误，密码未更改');
    }
    this.sendDataToWebview();
  }

  private getHtml(): string {
    const webviewDir = path.join(this.extensionPath, 'src', 'ui', 'webview');
    const echartsCdn = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';
    const jsPath = path.join(webviewDir, 'main.js');
    const scriptUri = this.panel!.webview.asWebviewUri(vscode.Uri.file(jsPath)).toString();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net ${this.panel!.webview.cspSource}; style-src 'unsafe-inline';">
  <title>DevTime</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      padding: 20px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header .subtitle { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .header .actions button {
      padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; margin-left: 8px;
    }
    .header .actions button:hover { opacity: 0.9; }
    .project-selector {
      display: flex; align-items: center; gap: 8px; margin-bottom: 16px;
    }
    .project-selector select {
      padding: 6px 32px 6px 10px;
      background: var(--vscode-dropdown-background);
      color: var(--vscode-dropdown-foreground);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px; font-size: 13px; cursor: pointer;
      appearance: none; -webkit-appearance: none;
    }
    .project-selector .current-badge {
      padding: 4px 12px; background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground); border-radius: 12px; font-size: 12px;
    }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card {
      background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 8px; padding: 16px;
    }
    .stat-card .label { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
    .stat-card .value { font-size: 24px; font-weight: 600; }
    .stat-card .cost { font-size: 14px; color: var(--vscode-textLink-foreground); margin-top: 4px; }
    .chart-container {
      background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 8px; padding: 16px; margin-bottom: 24px;
    }
    .chart-title { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
    .chart { width: 100%; height: 400px; }
    .tab-bar { display: flex; gap: 8px; margin-bottom: 16px; }
    .tab-bar button {
      padding: 8px 16px; background: var(--vscode-editorWidget-background);
      color: var(--vscode-editor-foreground); border: 1px solid var(--vscode-panel-border);
      border-radius: 4px; cursor: pointer;
    }
    .tab-bar button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
    .type-breakdown { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .type-card {
      background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 8px; padding: 16px; text-align: center;
    }
    .type-card .icon { font-size: 32px; margin-bottom: 8px; }
    .type-card .label { font-size: 14px; color: var(--vscode-descriptionForeground); }
    .type-card .value { font-size: 20px; font-weight: 600; margin-top: 4px; }
    .type-card .cost { font-size: 13px; color: var(--vscode-textLink-foreground); margin-top: 2px; }
    .storage-info { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>DevTime</h1>
      <div class="subtitle" id="storageInfo"></div>
    </div>
    <div class="actions">
      <button id="btnPassword">设置密码</button>
    </div>
  </div>

  <div class="project-selector">
    <select id="projectSelect"><option value="">加载中...</option></select>
    <span class="current-badge" id="currentBadge" style="display:none">当前</span>
  </div>

  <div class="stats-grid">
    <div class="stat-card"><div class="label">今日时间</div><div class="value" id="todayTime">0:00</div><div class="cost" id="todayCost">¥0</div></div>
    <div class="stat-card"><div class="label">本周时间</div><div class="value" id="weekTime">0:00</div><div class="cost" id="weekCost">¥0</div></div>
    <div class="stat-card"><div class="label">本月时间</div><div class="value" id="monthTime">0:00</div><div class="cost" id="monthCost">¥0</div></div>
    <div class="stat-card"><div class="label">总时间</div><div class="value" id="totalTime">0:00</div><div class="cost" id="totalCost">¥0</div></div>
  </div>

  <div class="chart-container">
    <div class="tab-bar">
      <button class="active" data-range="daily">每日</button>
      <button data-range="weekly">每周</button>
      <button data-range="monthly">每月</button>
      <button data-range="yearly">每年</button>
    </div>
    <div class="chart-title" id="chartTitle">每日统计</div>
    <div class="chart" id="timeChart"></div>
  </div>

  <div class="chart-container">
    <div class="chart-title">时间分布</div>
    <div class="type-breakdown">
      <div class="type-card"><div class="icon">✏️</div><div class="label">手动编辑</div><div class="value" id="manualTime">0:00</div><div class="cost" id="manualCost">¥0</div></div>
      <div class="type-card"><div class="icon">🤖</div><div class="label">Agent 修改</div><div class="value" id="agentTime">0:00</div><div class="cost" id="agentCost">¥0</div></div>
      <div class="type-card"><div class="icon">👁️</div><div class="label">文件查看</div><div class="value" id="viewTime">0:00</div><div class="cost" id="viewCost">¥0</div></div>
    </div>
  </div>

  <div class="storage-info" id="storageInfoFooter"></div>

  <script src="${echartsCdn}"></script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
