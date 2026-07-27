import * as vscode from 'vscode';

export interface devTimeConfig {
  hourlyRate: number;
  idleTimeout: number;
  currency: string;
  locale: string;
  storagePath: string;
  ignoredProjects: string[];
}

export function getConfig(): devTimeConfig {
  const config = vscode.workspace.getConfiguration('devtime');
  return {
    hourlyRate: config.get<number>('hourlyRate', 100),
    idleTimeout: config.get<number>('idleTimeout', 300),
    currency: config.get<string>('currency', '¥'),
    locale: config.get<string>('locale', 'zh-CN'),
    storagePath: config.get<string>('storagePath', ''),
    ignoredProjects: config.get<string[]>('ignoredProjects', []),
  };
}

export function onConfigChange(callback: (config: devTimeConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('devtime')) {
      callback(getConfig());
    }
  });
}
