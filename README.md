# WorkTime - VS Code 项目时间统计

统计开发者在项目上花费的时间，集中加密存储，支持多项目汇总、跨电脑同步、图表展示。

## 功能特性

- ⏱️ **智能计时**：自动检测用户活动，空闲时暂停计时
- 📊 **多维度统计**：日/周/月/年时间统计，成本计算，多项目汇总
- 🔐 **安全存储**：AES-256-GCM 加密，单文件集中存储所有项目数据
- ☁️ **跨电脑同步**：数据存于用户目录，可放在 iCloud/Dropbox 自动同步
- 🤖 **Agent 检测**：区分手动编辑与 AI 工具修改
- 🌍 **多语言支持**：中文/英文，支持自定义翻译

## 快速开始

1. 安装插件
2. 打开项目文件夹
3. 首次使用时设置密码
4. 开始工作，状态栏自动显示计时

## 数据存储

默认存储在 `~/.worktime/worktime-data.wt`（单文件、加密）。

**跨电脑同步**：在 VS Code 设置中修改 `worktime.storagePath` 为 iCloud/Dropbox 等云盘路径：

```json
{
  "worktime.storagePath": "/Users/xxx/Library/Mobile Documents/com~apple~CloudDocs/worktime"
}
```

也可设为任意本地路径，所有电脑指向同一云盘目录即可自动合并统计。

## 配置项

| 配置 | 说明 | 默认值 |
|------|------|--------|
| `worktime.hourlyRate` | 时薪 | 100 |
| `worktime.idleTimeout` | 空闲超时（秒） | 300 |
| `worktime.currency` | 货币符号 | ¥ |
| `worktime.locale` | 界面语言 | zh-CN |
| `worktime.storagePath` | 数据存储路径 | ~/.worktime/ |

## License

MIT
