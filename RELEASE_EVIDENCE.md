# 1.0 验收证据索引

1.0 候选代码验收：2026-10-14 完整源码回归 124/124 通过，完整离线网页/原生验收 17/17 通过，原始报告与截图位于本机 `downloads/acceptance/1791962186839-17000/`。报告版本为升级前的 0.29.0，功能代码与 1.0 相同；版本同步后另做运行包和实际离线窗口复核。运行数据不提交仓库。

可复用命令：`npm test`、`npm run check`、`npm run build`、`npm run verify:runtime`、`npm run acceptance`。Playwright 运行环境按 README 配置；验收只启动自己的 Profile，用户目录及原生共享目录均隔离。

## 功能证据

- F01–F02：`test/project-scope.test.cjs`、`test/send-lifecycle.test.cjs`；原生 `home`、`isolation`、`drafts`。验证无项目/多根无输入，不同项目历史、草稿、队列、任务不串；异步项目失效取消旧操作。
- F03：`test/cursor.test.cjs` 核对现代/旧 SQLite、完整根目录、多根排除、WAL 快照及原文件不变；`test/send-lifecycle.test.cjs` 验证 Cursor 背景迁移与失败重试。
- 当前本机 Cursor 的副本结构已核对，包含 ItemTable/cursorDiskKV/composerHeaders，现代列与解析器兼容；WorkTime 匹配到 4 条且无警告。检查不输出用户聊天内容，SQLite 只在副本运行。
- F04：`test/history.test.cjs`、`test/conversation-branch.test.cjs`、`test/send-lifecycle.test.cjs`；原生 `branches`、`drafts`、`isolation`。改名/删除在输入对话框返回后再次校验任务、项目和当前对话。
- F05：`test/account.test.cjs`、`test/account-login.test.cjs`、`test/login-session.test.cjs`、`test/bridge.test.cjs`、`test/send-lifecycle.test.cjs`；真实 CLI 离线导出登录协议结构核对 loginId。会员认证与模型请求是模拟后端证据，不是在线端到端证明。
- `test/model-catalog.test.cjs` 及真实 CLI 离线模型结构核对，补齐分页、隐藏过滤、去重、元数据/游标异常、过期连接及推理强度；集成测试核对第二页首选模型、异常不覆盖旧状态及无模型不启动任务。
- F06：`test/send-lifecycle.test.cjs`、`test/request-input.test.cjs`、`test/tasklog.test.cjs`、`test/markdown.test.cjs`；网页 `messages` 及原生 `offline`。验证发送、停止、早/晚事件、授权、取消、日志及公开文本渲染。
- F07–F08：`test/context.test.cjs`、`test/project-context.test.cjs`、`test/send-lifecycle.test.cjs`；原生 `settings`。目录范围、读取预算、选区、固定文件/规则、排除和更新后读取。
- F09：`test/message-queue.test.cjs`、`test/send-lifecycle.test.cjs`；网页 `messages`、原生 `queue`、`recovery`。入队确认、连续 Enter、下一草稿保留、排序/编辑/删除、失败与重开暂停。
- F10：`test/inline.test.cjs`、`test/inline-widget.test.cjs`、`test/inline-stream.test.cjs`、`test/send-lifecycle.test.cjs`；原生 `inline`。真实原生浮层以 QA 接收器测试输入，真实 Ctrl+K 只取消；生成/差异/应用协议使用模拟。
- F11：`test/review.test.cjs`、`test/checkpoints.test.cjs`；原生 `checkpoints`。改动捕获、不可读/超限/符号链接处理、归属、损坏内容、后续编辑拒绝覆盖及撤销/重做。
- F12：`test/conversation.test.cjs`、`test/history.test.cjs`；网页 `messages`。2000 消息分页/搜索、增量缺口请求、DOM 稳定、完整公开 Markdown 导出。
- F13：`test/settings-panel.test.cjs`、`test/usage.test.cjs`、`test/usage-ui.test.cjs`；原生 `settings`、`offline`。配置范围/来源/重置、用量未知/过期、诊断字段不包含认证秘密。
- 0.29 增加 `settings-usability`，核对范围各自值与生效值、外部刷新输入与焦点不丢、保存中所有配置控件锁定、明确确认释放及旧上下文确认不覆盖新输入。
- F14：`test/import-config.test.cjs`、`test/import-ui.test.cjs`、`test/vscode-import.test.cjs`；原生 `import`。设置冲突/备份、取消、插件流式打包，以及真实安装器接受 UTF8 文件和主题清单。
- F15：`test/storage.test.cjs`、`test/drafts.test.cjs`、`test/send-lifecycle.test.cjs`；原生 `drafts`、`recovery`。备份/损坏保留/并发冲突及只取回草稿、不重放任务。

## UI 与可用性证据

- U01：原生 `home`。四项入口、真实最近项目、账户菜单及窗口缩放；`gptide.homeSSH` 有扩展则调用，没有则明确提示并提供扩展入口，不宣称离线验证了远程连接。
- U02–U03：原生 `sidebar`、`home`、网页 `usability`；固定运行包补丁核对账户命令与隐藏的隧道菜单。图标中心随 220/320/460px 侧栏移动。
- U04：原生 `menus-light`、`menus-dark`、`inline`；网页 `usability`。菜单边框/阴影、子菜单、命令面板、原生输入、键盘取消与可见焦点。
- U05–U08：网页 `usability`、`messages`，原生 `settings`、`queue`、`recovery`。登录/预览期间操作禁用但草稿可编辑；晚回复保护；Esc 恢复触发器焦点；260/320/390px × 500px 辅助面板全展开时输入与发送保持在视口内。
- U06 的完整流程由原生 `home`、`isolation`、`branches`、`settings`、`queue`、`inline`、`checkpoints`、`recovery` 和模拟任务生命周期共同覆盖；不把模拟任务链写成真实模型验收。

## 发布复核

- 1.3.1：147 项源码测试、语法/构建/运行包验证通过。网页 3 项通过报告 `downloads/acceptance/1792058012810-35548/`；原生历史与文件处理 2 项通过报告 `downloads/acceptance/1792058111925-30124/`，最终最新轮次兼容、真实 Reject/Accept 和手动修改保护复核通过报告 `downloads/acceptance/1792058432989-35864/`。简化列表截图见 `downloads/acceptance/1792058222128-26416/compact-chat-300.png`。只显示待处理文件与真实增删行数；处理后隐藏。源代码管理仍负责复杂操作。未连接真实模型。

- 1.3.0 最终（2026-10-15）：143 项源码回归、语法/构建/运行包校验通过。完整离线验收 20/21 通过，报告 `downloads/acceptance/1792055993141-14992/`；新增历史验收误把按钮开始禁用当作 Undo 完成，修正为等待“已撤销”后，补充验收通过，报告 `downloads/acceptance/1792056231578-22732/`。21 个场景均已有通过结果。新增 `history-review` 覆盖 Pin、Archive / 恢复、More 的 Rename / Delete、重启持久化、Code Review Keep / Undo / Redo 和原生前后差异。系统删除确认在独立测试进程模拟返回“确认”，其余交互在真实编辑器中执行；未连接模型。

- 1.3.0 界面候选：139 项源码测试、语法/构建/运行包验证通过。完整离线验收首轮 19/20 通过，报告 `downloads/acceptance/1791968700094-29264/`；设置测试仍查找已移到菜单的固定引用标签，更新为菜单入口、排除规则与输入区无固定标签的断言。最终网页及原生设置 4/4 通过，报告 `downloads/acceptance/1791968944509-23500/`，20 个场景均已有通过结果。新增截图 `compact-chat-300.png` 及 260/320/390px 检查验证单排标签、简洁输入、空消息禁用发送、次要控制移入菜单、改动折叠和任务记录可展开。实际检查点、文件撤销/重做、键盘、新 Tab 和原生 SCM 操作保留。
- 1.2.0：139 项源码回归和完整离线验收 20/20 通过，报告 `downloads/acceptance/1791967594762-20252/`；最终 `chrome-scm` 原生补充验收通过，报告 `downloads/acceptance/1791967801058-30816/`。人头账户菜单保留用量入口，聊天辅助侧栏标题/活动栏隐藏且 Webview 填满可用高度，AI 提交按钮填入草稿，原生停止按钮确实取消生成并保留输入。生成器使用模拟；源码协议测试验证官方模型目录、只读临时线程和结构化消息输出，不宣称真实账户模型调用验收。
- 1.1.0：133 项源码回归通过，完整离线验收 19/19 通过，报告 `downloads/acceptance/1791965417350-31136/`。新增 `code` 原生测试确认虚拟文档语言、真实键盘只读和项目无写入；网页 `usability` 覆盖完整代码复制、失败重试、旧/外项目确认丢弃、展开和焦点保留、260px 窄栏。预览的只读行为指编辑器用户输入，第三方扩展 API 可修改虚拟文档内存；该预览不对应项目文件。
- 1.0.0 同步后 124 项源码测试、语法检查、构建与运行包验证通过，原生首页/默认离线窗口 2/2 复核通过，报告 `downloads/acceptance/1791962578791-2772/`。
- 发布提交 `4498fd4c375a23b8db6da2398ea59485168610ae` 已推送；[Source checks 38528060293](https://github.com/BigDaaddyy/GptIDE/actions/runs/38528060293) 通过，签核时本地与 origin/main 一致、工作区无改动。
