# GPTIDE

[简体中文](README.md) | [English](README.en.md)

I wanted to use GPT models while keeping the Cursor IDE experience I was used to, so I built this Cursor-inspired editor.

The entire project was developed using GPT-6.1 over five days.

Built on VSCodium, with an integrated ChatGPT / Codex coding assistant. Open a project and continue working without installing a separate chat extension.

<img src="assets/logo.svg" alt="GPTIDE" width="64" height="64">

## Getting started

On Windows, download the installer from [Releases](https://github.com/BigDaaddyy/GPTIDE/releases), or run `启动GPTIDE.cmd` from a prepared local build. Open a project folder, then sign in to ChatGPT through the account menu in the upper-right corner. GPTIDE uses the models and quota available to your account; no API key is required. Available models and limits depend on what your account reports.

- Project-specific conversations, multiple tabs, pinning and archiving, and access to locally stored Cursor / Codex project conversations.
- Agent code changes, selection rewriting, file diffs, and Undo / Keep controls.
- Model and reasoning effort selection, approval settings, and quick access to usage information.
- Import VS Code settings and extensions, with familiar editing, terminal, and Git workflows.

Usage information comes from the local cache and includes its last update time. Refreshing usage does not automatically send a model request.

Opening a project automatically reads local Codex sessions from `CODEX_HOME` (default: `~/.codex`). Use “更多操作 → 重新读取项目进度” (More → Reload project progress) in the chat toolbar to read them again. Only turns whose actual project path matches are shown. Continuing an imported conversation creates a GPTIDE conversation with its history as background, preserving the original Codex / Cursor records.

Editor data is stored in `%APPDATA%\GPTIDE`, and extensions in `%USERPROFILE%\.gptide\extensions`. Legacy project-local `data` directories are migrated by copying, leaving the originals intact. On first launch after installation, you can choose to import VS Code / Cursor settings, keybindings, snippets, and extensions. Uninstalling preserves personal data.

## Updates

GPTIDE checks GitHub for updates at startup. You can also check manually through **GPTIDE: 检查更新** in the command palette or the GPTIDE configuration page. When an update is available, GPTIDE asks whether to upgrade and restart or postpone. Only after you agree does it download and install a matching incremental update. Installation waits while tasks are running or changes are unsaved. If no matching update package exists, GPTIDE offers the full installer instead. Updates preserve personal data and stop replacing files if validation fails or installed files have been modified.

For publishing incremental updates, see the [update development guide](UPDATES.md) (Chinese).

## Development

### Run locally

Requires Windows x64 and Node.js 24. After cloning the repository, extract a complete Windows x64 VSCodium distribution into `app/`, ensuring that `app/VSCodium.exe` and `app/resources/app/` exist. The runtime is not committed to the repository; downloading the source alone is not enough to launch the editor.

Source checks and unit tests use Node.js built-in tools and do not require installing npm dependencies first:

```sh
npm run check
npm test
```

Once the runtime is ready:

```sh
npm run build
npm run verify:runtime
npm start
```

The build writes the integrated chat module, home screen, and UI customizations into the runtime and generates `app/GPTIDE.exe`. Rebuild after changing source files. After changing the extension or startup logic, fully quit and relaunch the application to load the new code.

### Code map

- `builtin/extension.cjs`: assistant entry point; `view.js`, `view.html`, and `view.css`: chat UI.
- `builtin/bridge.cjs`: Codex communication; `model-catalog.cjs` and `preferences.cjs`: models and configuration.
- `builtin/storage.cjs`, `project-scope.cjs`, and `data-paths.cjs`: conversation storage, project isolation, and data paths.
- `tools/home-render.js`, `workbench.css`, and `workbench-patch.cjs`: home screen and editor UI customizations.
- `test/`: regression tests; `tools/acceptance.cjs`: UI acceptance checks; `tools/installer-check.cjs`: installation, upgrade, and uninstall verification.

### Debugging and packaging

For UI issues, open `Developer: Toggle Developer Tools` from the command palette. For assistant issues, start with `GPTIDE: 本机诊断`. Include the GPTIDE version, reproduction steps, and screenshots in bug reports. Remove tokens and private code from logs before sharing them.

Use `GPTIDE_DATA_HOME` and `GPTIDE_EXTENSIONS_HOME` to point test instances at separate directories and keep everyday settings isolated. Codex authentication and configuration use `CODEX_HOME` (default: `~/.codex`), separately from editor data.

After building and verifying the runtime, set the `GPTIDE_MAKENSIS` environment variable to the full path of NSIS `makensis.exe`, then run `npm run package`. The installer and `SHA256SUMS.txt` are written to `downloads/release/<version>/`. Packaging uses a file allowlist to exclude personal data. If a `payload` directory already exists for that version, packaging refuses to overwrite it; inspect the previous output first.

Before committing, run `npm run check`, `npm test`, and `npm run check:privacy`. For runtime customizations, also build and run `verify:runtime`. Inspect the actual UI after changing editor patches; unit tests do not replace interaction checks.

Use your GitHub noreply email for commits. Keep personal settings, conversations, credentials, internal operation logs, and local screenshots out of the source repository. CI scans the full Git history for common secrets and identity information. Automated checks do not replace reviewing your changes before committing.

See [CHANGELOG](CHANGELOG.md) (Chinese) for version history. This is an independent open-source editor customization project with no official affiliation with OpenAI or Cursor. The underlying editor is [VSCodium](https://github.com/VSCodium/vscodium).
