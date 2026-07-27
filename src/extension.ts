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
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('DevTime: No workspace folder open');
    return;
  }

  const projectName = path.basename(workspaceFolder);
  i18n.init(context.extensionPath, workspaceFolder);
  const config = getConfig();

  if (config.ignoredProjects.includes(projectName)) {
    console.log(`DevTime: Project "${projectName}" is in ignored list`);
    return;
  }

  // 初始化存储
  const dataStore = new DataStore(workspaceFolder, config.storagePath);
  await dataStore.init();

  // 启动
  tracker = new TimeTracker(dataStore, config.idleTimeout);
  overviewPanel = new OverviewPanel(dataStore, context.extensionPath);

  context.subscriptions.push(
    vscode.commands.registerCommand('devtime.showOverview', () => overviewPanel?.show()),
    vscode.commands.registerCommand('devtime.startTracking', () => tracker?.start()),
    vscode.commands.registerCommand('devtime.stopTracking', async () => tracker?.stop()),
    onConfigChange((c) => tracker?.updateIdleTimeout(c.idleTimeout)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devtime')) overviewPanel?.refresh();
    })
  );

  tracker.start();
  dataStore.saveData();
  vscode.window.showInformationMessage(`DevTime: 计时已开始 | ${dataStore.getStoragePath()}`);
}

export function deactivate() {
  tracker?.dispose();
  overviewPanel?.dispose();
}
