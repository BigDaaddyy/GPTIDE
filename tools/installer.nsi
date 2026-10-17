Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
Name "GPTIDE"
VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "GPTIDE"
VIAddVersionKey /LANG=2052 "FileDescription" "GPTIDE 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "GPTIDE contributors"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\GPTIDE"
RequestExecutionLevel user
SetCompressor zlib
ShowInstDetails show
ShowUninstDetails show
!define MUI_ICON "${SOURCE}\assets\icon.ico"
!define MUI_UNICON "${SOURCE}\assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "GPTIDE ${VERSION}$\r$\n$\r$\n为习惯 Cursor 的开发者打造的 GPT 编程 IDE。$\r$\n$\r$\n安装包不包含个人聊天、设置或登录凭据。个人数据保存在 AppData\Roaming\GPTIDE，升级和卸载均保留。$\r$\n$\r$\n使用 AI 功能需要本机安装 Codex 并登录 ChatGPT。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
Var TestMode
Var Parameters
Var ProfileDirectory
!macro RequireClosed label
  IfFileExists "$INSTDIR\app\GPTIDE.exe" 0 ${label}
  ClearErrors
  FileOpen $0 "$INSTDIR\app\GPTIDE.exe" a
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONEXCLAMATION "请先退出安装目录中的 GPTIDE，再继续操作。" /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
  FileClose $0
  ${label}:
!macroend
Function .onInit
  SetShellVarContext current
  StrCpy $TestMode "0"
  ${GetParameters} $Parameters
  ${GetOptions} $Parameters "/TESTMODE=" $TestMode
FunctionEnd
Section "GPTIDE"
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == $0
    SetErrorLevel 2
    Abort
  ${EndIf}
  IfFileExists "$INSTDIR\app\*" 0 target_ready
  IfFileExists "$INSTDIR\installation.ini" target_ready
    MessageBox MB_OK|MB_ICONEXCLAMATION "此文件夹包含其他应用，请选择新的 GPTIDE 安装目录。" /SD IDOK
    SetErrorLevel 2
    Abort
  target_ready:
  !insertmacro RequireClosed install_closed
  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${PAYLOAD}\*"
  WriteINIStr "$INSTDIR\installation.ini" "GPTIDE" "Version" "${VERSION}"
  WriteINIStr "$INSTDIR\installation.ini" "GPTIDE" "TestMode" "$TestMode"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  StrCpy $ProfileDirectory "$APPDATA\GPTIDE"
  ${If} $TestMode == "1"
    ${GetParent} "$INSTDIR" $0
    StrCpy $ProfileDirectory "$0\Roaming\GPTIDE"
  ${EndIf}
  SetOutPath "$ProfileDirectory\User"
  IfFileExists "$ProfileDirectory\User\settings.json" settings_done
    File /oname=settings.json "${DEFAULTS}\settings.json"
  settings_done:
  IfFileExists "$ProfileDirectory\User\keybindings.json" keys_done
    File /oname=keybindings.json "${DEFAULTS}\keybindings.json"
  keys_done:
  SetOutPath "$INSTDIR"
  ${If} $TestMode != "1"
    CreateDirectory "$SMPROGRAMS\GPTIDE"
    CreateShortcut "$SMPROGRAMS\GPTIDE\GPTIDE.lnk" "$INSTDIR\app\GPTIDE.exe" '--user-data-dir "$APPDATA\GPTIDE" --shared-data-dir "$APPDATA\GPTIDE\shared" --extensions-dir "$PROFILE\.gptide\extensions" --new-window --skip-welcome' "$INSTDIR\assets\icon.ico"
    CreateShortcut "$DESKTOP\GPTIDE.lnk" "$INSTDIR\app\GPTIDE.exe" '--user-data-dir "$APPDATA\GPTIDE" --shared-data-dir "$APPDATA\GPTIDE\shared" --extensions-dir "$PROFILE\.gptide\extensions" --new-window --skip-welcome' "$INSTDIR\assets\icon.ico"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "DisplayName" "GPTIDE"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "DisplayVersion" "${VERSION}"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "DisplayIcon" "$INSTDIR\app\GPTIDE.exe"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "NoModify" 1
    WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE" "NoRepair" 1
  ${EndIf}
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\installation.ini" +3
    SetErrorLevel 2
    Abort
  ReadINIStr $TestMode "$INSTDIR\installation.ini" "GPTIDE" "TestMode"
  !insertmacro RequireClosed uninstall_closed
  ${If} $TestMode != "1"
    Delete "$DESKTOP\GPTIDE.lnk"
    Delete "$SMPROGRAMS\GPTIDE\GPTIDE.lnk"
    RMDir "$SMPROGRAMS\GPTIDE"
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GPTIDE"
  ${EndIf}
  ; Remove program files only. Never recursively remove INSTDIR or data.
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\tools"
  RMDir /r "$INSTDIR\assets"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\CHANGELOG.md"
  Delete "$INSTDIR\UPDATES.md"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\gptide-release.json"
  Delete "$INSTDIR\启动GPTIDE.cmd"
  Delete "$INSTDIR\installation.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
