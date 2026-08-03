import * as vscode from 'vscode';
import * as path from 'path';
import { i18n } from './i18n/i18n';
import { DataStore } from './storage/dataStore';
import { TimeTracker } from './tracker/timeTracker';
import { OverviewPanel } from './ui/overviewPanel';
import { getConfig, onConfigChange } from './config/settings';

let tracker: TimeTracker | undefined;
let overviewPanel: OverviewPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
  i18n.init(context.extensionPath);

  // 命令始终注册（不依赖工作区），避免空窗口/忽略项目时出现 command not found
  context.subscriptions.push(
    vscode.commands.registerCommand('devtime.showOverview', () => {
      if (!overviewPanel) {
        vscode.window.showWarningMessage('DevTime: 请先打开一个项目文件夹（且项目未被忽略）');
        return;
      }
      overviewPanel.show();
    }),
    vscode.commands.registerCommand('devtime.startTracking', () => {
      if (!tracker) {
        vscode.window.showWarningMessage('DevTime: 请先打开一个项目文件夹（且项目未被忽略）');
        return;
      }
      tracker.start();
    }),
    vscode.commands.registerCommand('devtime.stopTracking', async () => {
      if (!tracker) {
        vscode.window.showWarningMessage('DevTime: 请先打开一个项目文件夹（且项目未被忽略）');
        return;
      }
      await tracker.stop();
    }),
    onConfigChange((c) => tracker?.updateIdleTimeout(c.idleTimeout)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devtime')) overviewPanel?.refresh();
    })
  );

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('DevTime: 请先打开一个项目文件夹以开始计时');
    return;
  }

  const projectName = path.basename(workspaceFolder);
  i18n.init(context.extensionPath, workspaceFolder);
  const config = getConfig();

  if (config.ignoredProjects.includes(projectName)) {
    console.log(`DevTime: Project "${projectName}" is in ignored list`);
    return;
  }

  // 初始化存储（按项目拆分 JSON + 索引，增量更新）
  const dataStore = new DataStore(workspaceFolder, config.storagePath);
  await dataStore.init();

  // 启动
  tracker = new TimeTracker(dataStore, config.idleTimeout);
  overviewPanel = new OverviewPanel(dataStore, context.extensionPath);

  tracker.start();
  dataStore.saveData();
  vscode.window.showInformationMessage(`DevTime: 计时已开始 | ${dataStore.getStoragePath()}`);
}

export function deactivate() {
  tracker?.dispose();
  overviewPanel?.dispose();
}
