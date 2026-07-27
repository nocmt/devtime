import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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

  // 创建 dataStore
  let dataStore: DataStore | null = new DataStore(workspaceFolder, context.secrets, config.storagePath);

  // 密码流程
  const hasPassword = await dataStore.init();
  if (!hasPassword) {
    const hasDataFile = fs.existsSync(dataStore.getStoragePath());

    if (!hasDataFile) {
      // 首次使用：选路径 → 设密码
      dataStore = await handleFirstTimeSetup(workspaceFolder, context, dataStore);
      if (!dataStore) return;
    } else {
      // 数据文件存在但密码不对
      const ok = await handlePasswordRetry(dataStore);
      if (!ok) return;
    }
  }

  // 启动
  if (!dataStore) return;
  startTracking(context, dataStore, config);
  dataStore.saveData();
}

function startTracking(
  context: vscode.ExtensionContext,
  dataStore: DataStore,
  config: ReturnType<typeof getConfig>
) {
  tracker = new TimeTracker(dataStore, config.idleTimeout);
  overviewPanel = new OverviewPanel(dataStore, context.extensionPath);

  context.subscriptions.push(
    vscode.commands.registerCommand('devtime.showOverview', () => overviewPanel?.show()),
    vscode.commands.registerCommand('devtime.setPassword', async () => {
      await promptNewPassword(dataStore);
      overviewPanel?.refresh();
    }),
    vscode.commands.registerCommand('devtime.resetPassword', async () => {
      await handleChangePassword(dataStore);
      overviewPanel?.refresh();
    }),
    vscode.commands.registerCommand('devtime.startTracking', () => tracker?.start()),
    vscode.commands.registerCommand('devtime.stopTracking', async () => tracker?.stop()),
    onConfigChange((c) => tracker?.updateIdleTimeout(c.idleTimeout)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('devtime')) overviewPanel?.refresh();
    })
  );

  tracker.start();
  vscode.window.showInformationMessage(`DevTime: 计时已开始 | 数据: ${dataStore.getStoragePath()}`);
}

async function handleFirstTimeSetup(
  workspaceFolder: string,
  context: vscode.ExtensionContext,
  dataStore: DataStore
): Promise<DataStore | null> {
  const storagePath = await vscode.window.showInputBox({
    prompt: '数据存储路径（直接回车使用默认 ~/.devtime/）',
    value: dataStore.getStoragePath(),
  });
  if (storagePath === undefined) return null;

  if (storagePath && storagePath.trim()) {
    dataStore = new DataStore(workspaceFolder, context.secrets, storagePath.trim());
  }

  await promptFirstPassword(dataStore);
  await dataStore.init();
  if (!dataStore.hasPassword()) return null;
  return dataStore;
}

async function handlePasswordRetry(dataStore: DataStore): Promise<boolean> {
  while (true) {
    const password = await vscode.window.showInputBox({
      prompt: '请输入 DevTime 密码',
      password: true,
    });
    if (!password) return false;

    if (await dataStore.tryDecrypt(password)) {
      vscode.window.showInformationMessage('密码正确，数据已加载');
      return true;
    }

    const action = await vscode.window.showErrorMessage(
      '密码错误，请重试或重新生成数据文件',
      '重试', '重新生成'
    );
    if (action !== '重新生成') continue;

    const wipe = await vscode.window.showWarningMessage(
      '将清空数据文件并重新生成，原数据将丢失。确定？',
      { modal: true },
      '清空并重新生成', '取消'
    );
    if (wipe !== '清空并重新生成') continue;

    const newPw = await vscode.window.showInputBox({ prompt: '请输入新密码', password: true });
    if (!newPw) return false;
    const confirm = await vscode.window.showInputBox({ prompt: '请再次输入新密码确认', password: true });
    if (newPw !== confirm) {
      vscode.window.showErrorMessage('两次密码不一致');
      return false;
    }
    await dataStore.resetData(newPw);
    await dataStore.init();
    vscode.window.showInformationMessage('数据已重新生成，密码设置成功');
    return true;
  }
}

async function promptFirstPassword(dataStore: DataStore): Promise<void> {
  const password = await vscode.window.showInputBox({
    prompt: '首次使用，请设置 DevTime 密码（用于加密数据）',
    password: true,
  });
  if (!password) return;
  const confirm = await vscode.window.showInputBox({
    prompt: '请再次输入密码确认',
    password: true,
  });
  if (password !== confirm) {
    vscode.window.showErrorMessage('两次密码不一致');
    return;
  }
  await dataStore.setPassword(password);
  vscode.window.showInformationMessage('密码设置成功');
}

export function deactivate() {
  tracker?.dispose();
  overviewPanel?.dispose();
}

async function promptNewPassword(dataStore: DataStore): Promise<void> {
  const password = await vscode.window.showInputBox({
    prompt: '请输入新密码（用于加密数据）',
    password: true,
  });
  if (!password) return;
  const confirm = await vscode.window.showInputBox({
    prompt: '请再次输入密码确认',
    password: true,
  });
  if (password !== confirm) {
    vscode.window.showErrorMessage('两次密码不一致');
    return;
  }
  await dataStore.setPassword(password);
  vscode.window.showInformationMessage('密码设置成功');
}

async function handleChangePassword(dataStore: DataStore): Promise<void> {
  const oldPassword = await vscode.window.showInputBox({
    prompt: '请输入当前密码', password: true,
  });
  if (!oldPassword) return;
  const newPassword = await vscode.window.showInputBox({
    prompt: '请输入新密码', password: true,
  });
  if (!newPassword) return;
  const newConfirm = await vscode.window.showInputBox({
    prompt: '请再次输入新密码确认', password: true,
  });
  if (newPassword !== newConfirm) {
    vscode.window.showErrorMessage('两次密码不一致');
    return;
  }
  const ok = await dataStore.changePassword(oldPassword, newPassword);
  if (ok) {
    vscode.window.showInformationMessage('密码已更新，数据已用新密码重新加密');
  } else {
    vscode.window.showErrorMessage('当前密码错误，密码未更改');
  }
}
