# GPTIDE

想用 GPT 的模型，又习惯了 Cursor 的 IDE，所以做了这个仿 Cursor 的编辑器。

整个项目使用 GPT‑6.1 开发，历时 5 天完成。

基于 VSCodium，内置 ChatGPT / Codex 编程助手。打开项目就能继续工作，不需要另装聊天插件。

<img src="assets/logo.svg" alt="GPTIDE" width="64" height="64">

## 使用

Windows 可下载 Release 中的安装包，或双击 `启动GPTIDE.cmd`，打开项目文件夹，再从右上角账户入口登录 ChatGPT。使用账户提供的模型与额度，不需要填写 API Key；具体可用模型和用量以账户返回为准。

- 项目独立对话、多标签、置顶与归档，读取本机 Cursor 项目聊天记录。
- Agent 修改代码、选区改写、文件差异查看与 Undo / Keep。
- 模型与思考强度选择、批准方式配置、显眼的用量入口。
- 导入 VS Code 设置与插件，保留熟悉的编辑、终端和 Git 操作。

用量来自本机缓存，会标记更新时间；不会为了刷新用量自动发送模型请求。

数据放在 `%APPDATA%\GPTIDE`，扩展放在 `%USERPROFILE%\.gptide\extensions`；旧版项目目录的 `data` 会复制迁移并保留原件。首次安装启动时，可选择导入 VS Code / Cursor 的设置、快捷键、代码片段和扩展。卸载不删除个人数据。

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

提交改动前运行 `npm run check` 和 `npm test`；涉及运行包定制时再运行构建与 `verify:runtime`。修改编辑器补丁后应实际检查界面，单元测试不能替代交互验证。

版本变化见 [CHANGELOG](CHANGELOG.md)。这是独立的开源编辑器定制项目，与 OpenAI、Cursor 没有官方关联。基础编辑器来自 [VSCodium](https://github.com/VSCodium/vscodium)。
