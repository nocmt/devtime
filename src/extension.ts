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
  console.log('DevTime extension activated');

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    vscode.window.showWarningMessage('DevTime: No workspace folder open');
    return;
  }

  const projectName = path.basename(workspaceFolder);

  // 初始化 i18n
  i18n.init(context.extensionPath, workspaceFolder);

  // 初始化配置
  const config = getConfig();

  // 检查是否在忽略列表中
  if (config.ignoredProjects.includes(projectName)) {
    console.log(`DevTime: Project "${projectName}" is in ignored list, skipping tracking`);
    return;
  }

  // 初始化数据存储（传入自定义路径）
  const dataStore = new DataStore(workspaceFolder, context.secrets, config.storagePath);

  // 检查密码
  const hasPassword = await dataStore.init();
  if (!hasPassword) {
    const hasDataFile = fs.existsSync(dataStore.getStoragePath());

    // 数据文件不存在 → 首次使用，直接设密码
    if (!hasDataFile) {
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
      await dataStore.init();
      vscode.window.showInformationMessage('密码设置成功');
    } else {
      // 数据文件存在但密码不对 → 优先让用户重试
      let retry = true;
      while (retry) {
        const password = await vscode.window.showInputBox({
          prompt: '请输入 DevTime 密码',
          password: true,
        });
        if (!password) break;

        const ok = await dataStore.tryDecrypt(password);
        if (ok) {
          vscode.window.showInformationMessage('密码正确，数据已加载');
          break;
        }
        const action = await vscode.window.showErrorMessage(
          '密码错误，请重试或重新生成数据文件',
          '重试',
          '重新生成'
        );
        if (action === '重新生成') {
          const wipe = await vscode.window.showWarningMessage(
            '将清空数据文件并重新生成，原数据将丢失。确定？',
            { modal: true },
            '清空并重新生成',
            '取消'
          );
          if (wipe === '清空并重新生成') {
            const newPw = await vscode.window.showInputBox({
              prompt: '请输入新密码',
              password: true,
            });
            if (!newPw) return;
            const newConfirm = await vscode.window.showInputBox({
              prompt: '请再次输入新密码确认',
              password: true,
            });
            if (newPw !== newConfirm) {
              vscode.window.showErrorMessage('两次密码不一致');
              return;
            }
            await dataStore.resetData(newPw);
            await dataStore.init();
            vscode.window.showInformationMessage('数据已重新生成，密码设置成功');
            break;
          }
        }
        // '重试' → 循环继续
      }
    }
  }

  // 初始化计时器
  tracker = new TimeTracker(dataStore, config.idleTimeout);

  // 初始化概览面板
  overviewPanel = new OverviewPanel(dataStore, context.extensionPath);

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('devtime.showOverview', () => {
      overviewPanel?.show();
    }),

    vscode.commands.registerCommand('devtime.setPassword', async () => {
      // 首次设置/忘记密码后重设
      await promptNewPassword(dataStore);
      overviewPanel?.refresh();
    }),

    vscode.commands.registerCommand('devtime.resetPassword', async () => {
      // 正常换密码：验证旧密码 → 换新密码
      await handleChangePassword(dataStore);
      overviewPanel?.refresh();
    }),

    vscode.commands.registerCommand('devtime.startTracking', () => {
      tracker?.start();
    }),

    vscode.commands.registerCommand('devtime.stopTracking', async () => {
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
      if (e.affectsConfiguration('devtime')) {
        overviewPanel?.refresh();
      }
    })
  );

  // 自动开始追踪
  tracker.start();

  // 提示存储位置
  vscode.window.showInformationMessage(
    `DevTime: 计时已开始 | 数据存储: ${dataStore.getStoragePath()}`
  );
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

  const ok = await dataStore.changePassword(oldPassword, newPassword);
  if (ok) {
    vscode.window.showInformationMessage('密码已更新，数据已用新密码重新加密');
  } else {
    vscode.window.showErrorMessage('当前密码错误，密码未更改');
  }
}
