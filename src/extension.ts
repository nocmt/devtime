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
  console.log('WorkTime extension activated');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('WorkTime: No workspace folder open');
    return;
  }

  const projectName = path.basename(workspaceFolder);

  // 初始化 i18n
  i18n.init(context.extensionPath, workspaceFolder);

  // 初始化配置
  const config = getConfig();

  // 检查是否在忽略列表中
  if (config.ignoredProjects.includes(projectName)) {
    console.log(`WorkTime: Project "${projectName}" is in ignored list, skipping tracking`);
    return;
  }

  // 初始化数据存储（传入自定义路径）
  const dataStore = new DataStore(workspaceFolder, context.secrets, config.storagePath);

  // 检查密码
  const hasPassword = await dataStore.init();
  if (!hasPassword) {
    const action = await vscode.window.showInformationMessage(
      i18n.t('overview.decryptError'),
      i18n.t('overview.decryptError.action')
    );

    if (action === i18n.t('overview.decryptError.action')) {
      await handleSetPassword(dataStore);
      const retryInit = await dataStore.init();
      if (!retryInit) {
        vscode.window.showErrorMessage('WorkTime: Failed to initialize data storage');
        return;
      }
    } else {
      return;
    }
  }

  // 初始化计时器
  tracker = new TimeTracker(dataStore, config.idleTimeout);

  // 初始化概览面板
  overviewPanel = new OverviewPanel(dataStore, context.extensionPath);

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('worktime.showOverview', () => {
      overviewPanel?.show();
    }),

    vscode.commands.registerCommand('worktime.setPassword', async () => {
      await handleSetPassword(dataStore);
    }),

    vscode.commands.registerCommand('worktime.resetPassword', async () => {
      await handleResetPassword(dataStore);
    }),

    vscode.commands.registerCommand('worktime.startTracking', () => {
      tracker?.start();
    }),

    vscode.commands.registerCommand('worktime.stopTracking', async () => {
      await tracker?.stop();
    })
  );

  // 监听配置变化
  context.subscriptions.push(
    onConfigChange((newConfig) => {
      tracker?.updateIdleTimeout(newConfig.idleTimeout);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('worktime')) {
        overviewPanel?.refresh();
      }
    })
  );

  // 自动开始追踪
  tracker.start();

  // 提示存储位置
  vscode.window.showInformationMessage(
    `WorkTime: 计时已开始 | 数据存储: ${dataStore.getStoragePath()}`
  );
}

export function deactivate() {
  tracker?.dispose();
  overviewPanel?.dispose();
}

async function handleSetPassword(dataStore: DataStore): Promise<void> {
  const password = await vscode.window.showInputBox({
    prompt: i18n.t('overview.setPassword.prompt'),
    password: true,
  });

  if (!password) return;

  const confirm = await vscode.window.showInputBox({
    prompt: i18n.t('overview.setPassword.confirm'),
    password: true,
  });

  if (password !== confirm) {
    vscode.window.showErrorMessage(i18n.t('overview.setPassword.mismatch'));
    return;
  }

  await dataStore.setPassword(password);
  vscode.window.showInformationMessage(i18n.t('overview.setPassword.success'));
}

async function handleResetPassword(dataStore: DataStore): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    i18n.t('overview.resetPassword.confirm'),
    { modal: true },
    'OK'
  );

  if (confirm !== 'OK') return;

  await handleSetPassword(dataStore);
}
