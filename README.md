# DevTime - VS Code 项目时间统计

统计开发者在项目上花费的时间，多项目汇总、跨电脑同步、图表展示。

## 功能特性

- ⏱️ **智能计时**：自动检测用户活动，空闲时暂停计时
- 📊 **多维度统计**：日/周/月/年时间统计，成本计算，多项目汇总
- 📁 **增量存储**：每个项目一个独立 JSON 文件，只更新有变动的项目文件，同步高效
- ☁️ **跨电脑同步**：数据存于用户目录，可放在 iCloud/Dropbox 自动同步
- 🤖 **Agent 检测**：区分手动编辑与 AI 工具修改
- 🌍 **多语言支持**：中文/英文

## 快速开始

1. 安装插件
2. 打开项目文件夹
3. 开始工作，状态栏自动显示计时

## 数据存储

默认存储在平台对应目录下（不用点开头目录，避免 iCloud/Dropbox 等云盘忽略隐藏文件）：

```text
macOS:   ~/Library/devtime/
Windows: ~/devtime/
└── projects/
    ├── <项目id>.<设备id>.json  # 每台设备一个独立分片文件
    ├── <项目id>.<设备id>.json  # 其他设备的分片
    └── ...
```

- **增量更新**：计时数据只写入当前项目对应的 JSON 文件，不再每次重写全量聚合文件。
- **多设备分片**：每台设备只写自己的分片文件（`<项目id>.<设备id>.json`），读取时自动合并所有分片——两台电脑同时编辑同一项目也不会互相覆盖；项目 ID 不含点，旧版无设备后缀的单文件（`<项目id>.json`）仍会兼容合并。
- **迁移兼容**：旧版 `devtime-data.json` 会在首次启动时自动拆分为按项目的文件，原文件保留为 `.migrated` 备份；旧版 `~/.devtime` / `~/devtime` 目录会自动迁移到平台新默认目录（macOS: `~/Library/devtime/`，Windows: `~/devtime/`）。

**跨电脑同步**：在 VS Code 设置中修改 `devtime.storagePath` 为 iCloud/Dropbox 等云盘路径；指定目录后扩展会在该目录内自动创建 `devtime` 子目录存放数据（若所选目录本身就是 `devtime` 则直接使用）：

```json
{
  "devtime.storagePath": "/Users/xxx/Library/Mobile Documents/com~apple~CloudDocs"
}
```

## 配置项

| 配置 | 说明 | 默认值 |
| --- | --- | --- |
| `devtime.hourlyRate` | 时薪 | 100 |
| `devtime.idleTimeout` | 空闲超时（秒） | 300 |
| `devtime.currency` | 货币符号 | ¥ |
| `devtime.locale` | 界面语言 | zh-CN |
| `devtime.storagePath` | 数据存储目录 | macOS \~/Library/devtime/ · Windows \~/devtime/ |
| `devtime.ignoredProjects` | 忽略的项目文件夹名 | \[\] |

## License

MIT