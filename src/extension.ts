import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { i18n } from './i18n/i18n';
import { DataStore } from './storage/dataStore';
import { TimeTracker } from './tracker/timeTracker';
import { OverviewPanel } from './ui/overviewPanel';
import { getConfig, onConfigChange } from './config/settings';

let tracker: TimeTracker | undefined;
let overviewPanel: OverviewPanel | undefined;
let logChannel: vscode.OutputChannel;

function log(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  if (logChannel) logChannel.appendLine(line);
}

export async function activate(context: vscode.ExtensionContext) {
  logChannel = vscode.window.createOutputChannel('DevTime');
  log('DevTime 开始激活');
  log(`  extensionPath = ${context.extensionPath}`);
  log(`  os.homedir()  = ${os.homedir()}`);

  try {
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
    log('  命令已注册');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    log(`  workspaceFolder = ${workspaceFolder || '(空)'}`);
    if (!workspaceFolder) {
      log('  未打开项目文件夹，跳过计时初始化（命令仍可用）');
      vscode.window.showWarningMessage('DevTime: 请先打开一个项目文件夹以开始计时');
      return;
    }

    const projectName = path.basename(workspaceFolder);
    i18n.init(context.extensionPath, workspaceFolder);
    const config = getConfig();
    log(`  storagePath = "${config.storagePath}"`);

    if (config.ignoredProjects.includes(projectName)) {
      log(`  项目 ${projectName} 在忽略列表中，跳过计时`);
      return;
    }

    const dataStore = new DataStore(workspaceFolder, config.storagePath);
    await dataStore.init();
    log('  存储初始化完成');
    log(`  dataRoot = ${dataStore.getStoragePath()}`);
    if (dataStore.wasFallbackUsed()) {
      const reason = dataStore.getFallbackReason();
      log(`!! 存储路径回退默认: ${reason}`);
      vscode.window.showWarningMessage(`DevTime: ${reason}，已回退到默认目录 ${dataStore.getStoragePath()}。请检查 devtime.storagePath 设置。`);
    }

    tracker = new TimeTracker(dataStore, config.idleTimeout);
    overviewPanel = new OverviewPanel(dataStore, context.extensionPath);

    tracker.start();
    log('  计时已启动');
    log(`  数据目录: ${dataStore.getStoragePath()}`);
    vscode.window.showInformationMessage(`DevTime: 计时已开始 | ${dataStore.getStoragePath()}`);
  } catch (e) {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    log(`!! 激活失败: ${msg}`);
    vscode.window.showErrorMessage(`DevTime 激活失败: ${e instanceof Error ? e.message : String(e)}（详见输出面板 DevTime 频道）`);
    logChannel.show();
  }
}

export function deactivate() {
  tracker?.dispose();
  overviewPanel?.dispose();
  logChannel?.dispose();
}
