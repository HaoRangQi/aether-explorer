# Aether Explorer 隐私与外发请求说明

> 最后更新：2026-05-24

Aether Explorer 是本地优先的 macOS 文件工作台。文件浏览、标签、收藏、设置和 AI 操作历史默认保存在本机，不做商业化追踪，不内置遥测，不上传用户文件。

## 默认本地数据

- 设置：Tauri Store 与必要的 localStorage 降级数据。
- 标签 / 收藏 / 最近项目：本机持久化。
- 日志：`~/Library/Logs/Aether Explorer/`，用于崩溃和诊断。
- AI API Key：仅在用户主动配置 AI provider 时保存到本机设置；不会写入仓库级 `.env`。

## 可能产生网络请求的功能

| 功能 | 触发条件 | 请求目标 | 可关闭方式 |
|------|----------|----------|------------|
| 更新检查 | 启用 Tauri updater 或发布构建检查更新 | GitHub Release stable manifest | 使用本地开发构建，或后续关闭更新检查 |
| 远程壁纸 URL | 用户在设置中填写 http/https 壁纸 | 用户填写的图片 URL | 清空壁纸 URL 或使用本地图片 |
| AI provider | 用户主动配置并运行 AI 文件助手 | 用户配置的 provider base URL；请求可能包含用户指令、选中文件名、路径、扩展名和操作计划，不会默认上传文件正文 | 不配置 AI provider，或禁用 AI 扩展 |
| 外部链接扩展 | 用户点击 URL 类型右键扩展 | 扩展模板生成的 http/https/mailto URL | 禁用对应扩展 |
| `shell.open` | 用户点击明确的外部链接动作 | 系统默认浏览器 / 邮件客户端处理 | 不点击该动作，或禁用扩展 |

## 不做的事

- 不上传文件内容做索引。
- 不收集使用分析、崩溃遥测或广告标识。
- 不接入商业化订阅、企业账户或云同步。
- 不把商业化、App Store 或 notarization 作为当前公益分发的路线阻塞项；但发版候选的 Full Disk Access 验收必须使用稳定签名身份，不能用未签名 / ad-hoc 构建作为 release evidence。

## 当前限制

- 严格隐私模式尚未实现；当前通过逐项禁用远程壁纸、AI provider 和 URL 扩展来减少外发面。
- 更新回滚、staged rollout、kill switch 和 notarization 仍在后续路线中；稳定签名身份和 TCC-only FDA 证据属于当前发版候选权限验收范围。
