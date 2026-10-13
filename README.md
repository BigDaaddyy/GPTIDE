# GptIDE

基于 VSCodium / VS Code 开源构建的 Windows IDE。AI 聊天随软件内置，不需要用户安装插件。当前是对开源编辑器完整运行包的定制版本，尚非从 VS Code 源码重编译的独立分支。

## 使用

双击 `启动GptIDE.cmd`。在软件内选择 **文件 → 打开文件夹**，选项目目录，自动读取该项目上次的 GptIDE 聊天及匹配的 Cursor 历史。聊天下拉列表可切换对话，Ctrl+L 打开聊天。首次使用点击 ChatGPT 登录；本机已有有效 Codex 登录时会读取其登录状态。

只支持 ChatGPT 会员认证，不配置 API Key，不自动切换 API 付费。会员额度与其他 Codex 使用共享，额度耗尽会显示后端错误；软件不会购买额度。模型来自官方返回的列表，首选 GPT-6.1 Sol。

Agent 模式可以修改项目；Ask 模式使用只读沙盒，Plan 模式先调查并输出实施计划。需要额外授权的操作会在 IDE 弹窗中显示。模型旁可选官方支持的推理强度。

## 0.2 版交互

- 左侧文件树、中间原生代码编辑器、右侧内置 Chat。Ctrl+L 聚焦聊天，Ctrl+Shift+L 新建对话。
- 历史按钮打开可搜索的项目对话列表，区分 Cursor 和 GptIDE；菜单支持重命名、删除本地对话、刷新和登录。
- 点击 `@文件` 选择项目文件，或点击当前文件按钮引用编辑器文件/选区。编辑器中 Ctrl+K 将选区附到聊天；这不是内联改写。
- 支持流式 Markdown、代码块复制、表格、消息复制、停止生成和滚动回最新消息。
- 长对话默认显示最近 100 条，点击加载更早消息继续查看；流式输出保留其他消息节点。
- Agent 通过文件修改工具产生的文本改动可逐文件查看差异、保留或撤销，无须项目已有 Git 仓库。撤销前检查当前内容和未保存编辑，发生后续改动时拒绝覆盖。通过终端命令产生的改动仍应从 Git 查看。

修改预览为单轮记录，下一次 Agent 修改会替换上一轮预览。最多采集 2500 个文本文件，总量约 32 MiB，每文件 512 KiB，跳过二进制、依赖和构建目录；普通项目的 app/data 源码目录保留。聊天及预览保存在本机 `data/`，不要把该目录上传到 GitHub。

## Cursor 历史

GptIDE 历史保存时保留 `.bak` 上一份备份；主文件损坏时尝试恢复并显示提示，损坏原文会保留。两份都无法读取时暂停发送，请先修复本地记录，避免覆盖证据。草稿按对话保留在编辑器本地状态中。

同项目多窗口保存使用进程锁及版本校验。发生冲突时主历史不被覆盖，本窗口内容保留在同目录 `.conflict-*.json`，点击刷新重新加载；当前不自动合并冲突对话。进程崩溃留下的锁会在确认原进程已结束后清理。

启动或打开项目后，按完整目录路径匹配 `%APPDATA%/Cursor/User/workspaceStorage`，从 SQLite 快照读取 composer 和 bubble 数据，保留原文件。首次打开默认显示最近的一条；以后优先恢复 GptIDE 上次的对话。刷新可重新读取 Cursor 最近进度。

Cursor 对话只能作为上下文迁移，不能恢复 Cursor 内部代理状态、未完成工具调用、检查点或隐藏的推理内容。首次在导入对话发送消息时，创建新的 Codex 对话；过长历史会提示并发送最近约 18 万字符，全部原文仍可查看。当前支持本机默认用户目录和显式自定义目录，多根工作区的项目根由首个打开的文件夹决定。

## 构建和数据

从 GitHub 克隆后，先安装 Node.js 24 或更新版本及 Codex，然后在项目根目录执行 `powershell -ExecutionPolicy Bypass -File tools/setup.ps1`。脚本下载固定版本的官方 VSCodium，验证 SHA-256，解压完整运行包并构建内置聊天。Git 仓库不包含大型第三方运行包、私人聊天数据和认证凭据。

`npm run check`、`npm test`、`npm run build`。`app/` 包含完整 VSCodium 运行环境；`builtin/` 是内置聊天源码；`tools/` 是打包、启动和导入程序；`data/` 为本机编辑器设置及项目聊天。源码不包含登录凭据，Codex 自行管理 ChatGPT 登录。

运行要求：Windows x64，本机有 Codex CLI / Codex 桌面应用。自动发现 `%LOCALAPPDATA%/OpenAI/Codex/bin/*/codex.exe`，也可以在设置里填写 `gptide.codexPath`。

底座来源：https://github.com/VSCodium/vscodium/releases/tag/1.135.06055

附带 `example-project/` 可体验打开文件夹自动恢复聊天。若打开 GptIDE 软件源码的整个根目录，VS Code 会把目录内的编辑器模块视作可被项目修改的代码，在未信任该目录时禁用模块；普通项目文件夹不受此影响。

官方会员接入：https://learn.chatgpt.com/docs/app-server

第三方许可随 `app/` 保留。此版本未实现 Cursor Tab 补全、语义索引或 Cursor 私有功能，不应被称为完整 Cursor 复刻。
