import * as vscode from 'vscode';
import { i18n } from '../i18n/i18n';

export class StatusBarManager {
  private item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.item.command = 'worktime.showOverview';
  }

  updateTracking(timeStr: string): void {
    this.item.text = i18n.t('statusBar.tracking', { time: timeStr });
    this.item.tooltip = 'WorkTime - Click to view overview';
    this.item.show();
  }

  updateIdle(): void {
    this.item.text = i18n.t('statusBar.idle');
    this.item.tooltip = 'WorkTime - Idle';
    this.item.show();
  }

  updateStopped(): void {
    this.item.text = i18n.t('statusBar.stopped');
    this.item.tooltip = 'WorkTime - Click to view overview';
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  dispose(): void {
    this.item.dispose();
  }
}
