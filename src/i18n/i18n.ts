import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type Messages = Record<string, string>;

export class I18n {
  private static instance: I18n;
  private messages: Messages = {};
  private fallback: Messages = {};

  private constructor() {}

  static getInstance(): I18n {
    if (!I18n.instance) {
      I18n.instance = new I18n();
    }
    return I18n.instance;
  }

  /**
   * 初始化国际化
   * @param extensionPath 插件根目录
   * @param workspaceFolder 工作区目录（用于加载用户自定义翻译）
   */
  init(extensionPath: string, workspaceFolder?: string): void {
    const config = vscode.workspace.getConfiguration('devtime');
    const locale = config.get<string>('locale', 'zh-CN');

    // 加载内置翻译
    this.fallback = this.loadLocale(path.join(extensionPath, 'src', 'i18n', 'en.json'));
    this.messages = this.loadLocale(path.join(extensionPath, 'src', 'i18n', `${locale}.json`));

    // 加载用户自定义翻译（覆盖内置）
    if (workspaceFolder) {
      const userLocalePath = path.join(workspaceFolder, '.devtime', 'locales', `${locale}.json`);
      if (fs.existsSync(userLocalePath)) {
        const userMessages = this.loadLocale(userLocalePath);
        this.messages = { ...this.messages, ...userMessages };
      }
    }
  }

  private loadLocale(filePath: string): Messages {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }
    } catch (e) {
      console.error(`Failed to load locale: ${filePath}`, e);
    }
    return {};
  }

  /**
   * 获取翻译文本
   * @param key 翻译键
   * @param params 替换参数，如 { time: '01:23:45' }
   */
  t(key: string, params?: Record<string, string>): string {
    let text = this.messages[key] || this.fallback[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      });
    }
    return text;
  }
}

export const i18n = I18n.getInstance();
