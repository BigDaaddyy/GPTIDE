# GPTIDE 1.7.0

首次提供 Windows x64 中文安装包。

- 默认安装到 `%LOCALAPPDATA%\Programs\GPTIDE`，创建桌面和开始菜单入口。
- 设置、项目聊天、草稿、修改检查点和导入备份放在 `%APPDATA%\GPTIDE`；扩展放在 `%USERPROFILE%\.gptide\extensions`。
- 旧版 `data` 只复制迁移，不删除原件，也不覆盖新目录已有文件。
- 安装后首次启动检测 VS Code / Cursor，询问是否导入设置、快捷键、代码片段及扩展；两个都有时可选来源，跳过后不再反复提示。
- Cursor 历史聊天仍按打开的项目读取，保持项目隔离。
- 升级和卸载保留个人数据。安装包不包含作者的账号、配置、聊天或项目代码。

使用 AI 功能需要本机有 Codex 桌面应用或可配置的 Codex 可执行文件，并通过 ChatGPT 登录。可用模型与额度由账号决定。

请完全退出旧版 GPTIDE 后再安装。此安装包尚未代码签名，Windows 可能显示未知发布者；可使用同一 Release 的 `SHA256SUMS.txt` 核对文件。
