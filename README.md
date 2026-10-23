# GPTIDE

[简体中文](README.md) | [English](README.en.md)

想用 GPT 的模型，又习惯了 Cursor 的 IDE，所以做了这个仿 Cursor 的编辑器。

整个项目使用 GPT‑6.1 开发，历时 5 天完成。

基于 VSCodium，内置 ChatGPT / Codex 编程助手。打开项目就能继续工作，不需要另装聊天插件。

<img src="assets/logo.svg" alt="GPTIDE" width="64" height="64">

## 使用

Windows 可下载 Release 中的安装包，或双击 `启动GPTIDE.cmd`，打开项目文件夹，再从右上角账户入口登录 ChatGPT。使用账户提供的模型与额度，不需要填写 API Key；具体可用模型和用量以账户返回为准。

- 项目独立对话、多标签、置顶与归档，读取本机 Cursor / Codex 项目聊天记录。
- Agent 修改代码、选区改写、文件差异查看与 Undo / Keep。
- 模型与思考强度选择、批准方式配置、显眼的用量入口。
- 导入 VS Code 设置与插件，保留熟悉的编辑、终端和 Git 操作。

用量来自本机缓存，会标记更新时间；不会为了刷新用量自动发送模型请求。

打开项目时自动读取本机 Codex 会话（`CODEX_HOME`，默认 `~/.codex`），也可通过聊天栏的“更多操作 → 重新读取项目进度”重新读取。仅显示实际项目路径匹配的对话；继续导入的记录会创建 GPTIDE 对话并带入历史背景，保留 Codex / Cursor 原记录。

数据放在 `%APPDATA%\GPTIDE`，扩展放在 `%USERPROFILE%\.gptide\extensions`；旧版项目目录的 `data` 会复制迁移并保留原件。首次安装启动时，可选择导入 VS Code / Cursor 的设置、快捷键、代码片段和扩展。卸载不删除个人数据。

## 更新

启动即检查 GitHub 新版，也可在 **帮助 → 关于 → 检查更新**、命令面板的 **GPTIDE: 检查更新** 或 GPTIDE 配置页手动检查。发现新版先询问“升级并重启 / 稍后”，同意后才下载匹配的增量包并安装，任务运行或有未保存内容时延后。没有匹配包时提供完整安装包入口。更新保留个人数据，文件被修改或校验失败时会停止替换。

增量包发布方式见 [更新开发说明](UPDATES.md)。

## 开发

### 本地运行

需要 Windows x64、Node.js 24。克隆仓库后，将完整的 Windows x64 VSCodium 运行包解压到 `app/`，确保存在 `app/VSCodium.exe` 和 `app/resources/app/`。运行包不随源码提交；仅下载源码不能直接启动编辑器。

源码检查和单元测试使用 Node.js 内置工具，不需要先安装 npm 依赖：

```sh
npm run check
npm test
```

准备好运行包后：

```sh
npm run build
npm run verify:runtime
npm start
```

`build` 将内置聊天模块、首页和界面定制写入运行包，并生成 `app/GPTIDE.exe`。修改源码后重新构建；修改扩展或启动逻辑后，完全退出再启动以加载新代码。

### 从哪里改

- `builtin/extension.cjs`：内置助手入口；`view.js`、`view.html`、`view.css`：聊天界面。
- `builtin/bridge.cjs`：Codex 通信；`model-catalog.cjs`、`preferences.cjs`：模型与配置。
- `builtin/storage.cjs`、`project-scope.cjs`、`data-paths.cjs`：对话存储、项目隔离和数据路径。
- `tools/home-render.js`、`workbench.css`、`workbench-patch.cjs`：首页及编辑器界面定制。
- `test/`：单元回归；`tools/acceptance.cjs`：界面验收；`tools/installer-check.cjs`：安装、升级和卸载验证。

### 调试与打包

界面异常可通过命令面板的 `Developer: Toggle Developer Tools` 查看；助手相关问题可先运行 `GPTIDE: 本机诊断`。报告问题时附上 GPTIDE 版本、复现步骤和截图，日志请先移除令牌及私人代码。

测试数据可通过 `GPTIDE_DATA_HOME` 和 `GPTIDE_EXTENSIONS_HOME` 指向独立目录，避免混用日常配置。Codex 登录与配置使用 `CODEX_HOME`（默认 `~/.codex`），与编辑器数据分开。

构建并验证运行包后，设置环境变量 `GPTIDE_MAKENSIS` 为 NSIS 的 `makensis.exe` 完整路径，再执行 `npm run package`。安装包和 `SHA256SUMS.txt` 输出到 `downloads/release/<版本>/`。打包使用文件白名单，排除个人数据；同版本已有 `payload` 时会拒绝覆盖，需先检查旧产物。

提交改动前运行 `npm run check`、`npm test` 和 `npm run check:privacy`；涉及运行包定制时再运行构建与 `verify:runtime`。修改编辑器补丁后应实际检查界面，单元测试不能替代交互验证。

请使用 GitHub 的匿名提交邮箱。个人配置、聊天、登录凭据、内部操作日志和本机截图不纳入源码；CI 会扫描完整 Git 历史并拦截常见密钥及身份信息。自动检查不能代替提交前人工确认。

版本变化见 [CHANGELOG](CHANGELOG.md)。这是独立的开源编辑器定制项目，与 OpenAI、Cursor 没有官方关联。基础编辑器来自 [VSCodium](https://github.com/VSCodium/vscodium)。
