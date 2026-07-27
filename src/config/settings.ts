import * as vscode from 'vscode';

export interface WorkTimeConfig {
  hourlyRate: number;
  idleTimeout: number;
  currency: string;
  locale: string;
}

export function getConfig(): WorkTimeConfig {
  const config = vscode.workspace.getConfiguration('worktime');
  return {
    hourlyRate: config.get<number>('hourlyRate', 100),
    idleTimeout: config.get<number>('idleTimeout', 300),
    currency: config.get<string>('currency', '¥'),
    locale: config.get<string>('locale', 'zh-CN'),
  };
}

export function onConfigChange(callback: (config: WorkTimeConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('worktime')) {
      callback(getConfig());
    }
  });
}
