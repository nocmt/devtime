# WorkTime - VS Code 项目时间统计

统计开发者在项目上花费的时间，支持加密存储、git 同步、图表展示。

## 功能特性

- ⏱️ **智能计时**：自动检测用户活动，空闲时暂停计时
- 📊 **多维度统计**：日/周/月/年时间统计，成本计算
- 🔐 **安全存储**：AES-256-GCM 加密，支持 git 同步
- 🤖 **Agent 检测**：区分手动编辑与 AI 工具修改
- 🌍 **多语言支持**：中文/英文，支持自定义翻译

## 快速开始

1. 安装插件
2. 打开项目文件夹
3. 首次使用时设置密码
4. 开始工作，状态栏自动显示计时

## 配置项

| 配置 | 说明 | 默认值 |
|------|------|--------|
| `worktime.hourlyRate` | 时薪 | 100 |
| `worktime.idleTimeout` | 空闲超时（秒） | 300 |
| `worktime.currency` | 货币符号 | ¥ |
| `worktime.locale` | 界面语言 | zh-CN |

## 命令

- `WorkTime: 打开概览` - 查看统计图表
- `WorkTime: 设置密码` - 设置加密密码
- `WorkTime: 重置密码` - 重置密码并重新加密数据
- `WorkTime: 开始计时` - 开始追踪
- `WorkTime: 停止计时` - 停止追踪

## 数据同步

数据存储在项目 `.worktime/` 目录下，可通过 git 同步：

```bash
git add .worktime/data.wt
git commit -m "sync worktime data"
git push
```

**注意**：请勿将密码提交到 git，密码存储在 VS Code SecretStorage 中。

## 自定义翻译

在项目 `.worktime/locales/` 目录下创建语言文件：

```json
{
  "overview.daily": "Daily Stats"
}
```

## 常见问题

**Q: 密码忘记了怎么办？**
A: 运行 `WorkTime: 重置密码` 命令，使用新密码重新加密数据。

**Q: 数据文件损坏了怎么办？**
A: 从 git 历史恢复 `.worktime/data.wt` 文件。

**Q: 如何在多台电脑间同步？**
A: 将 `.worktime/data.wt` 提交到 git，每台电脑首次使用时输入相同密码。

## License

MIT
