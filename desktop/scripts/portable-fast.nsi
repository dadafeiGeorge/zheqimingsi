; 哲启明思 · 秒开缓存式单文件便携启动器 (NSIS Unicode)
; - 首次运行：加互斥锁单遍直解至 %LOCALAPPDATA%\ZheQiMingSi\runtime\<BUILD_ID>\ 并写入 .ready 标记
; - 后续运行 / 重复双击：零解压、零磁盘拷贝、零插件释放，~15ms 直接拉起主程序，由 Electron 单实例唤醒前台
; - 彻底消除 electron-builder 默认便携版每次启动重复解压 320MB（耗时 10~25s）及并发锁冲突弹出「无法关闭」报错的缺陷

Unicode true
SetCompress off
CRCCheck off
SilentInstall silent
AutoCloseWindow true
RequestExecutionLevel user

!addplugindir "${NSIS_EXTRA_PLUGINS}"

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "哲启明思"
Icon "${ICON_PATH}"
OutFile "${OUT_FILE}"

VIProductVersion "1.2.0.0"
VIAddVersionKey "ProductName" "哲启明思"
VIAddVersionKey "FileDescription" "哲启明思 v1.2.0 (2026.11.27) · 哲学典藏阅读与思想电台"
VIAddVersionKey "FileVersion" "1.2.0"
VIAddVersionKey "ProductVersion" "1.2.0 (2026.11.27)"
VIAddVersionKey "LegalCopyright" "哲启明思 · 2026.11.27"

Var CACHE_ROOT
Var CACHE_DIR
Var STAGE_DIR
Var MUTEX_HANDLE
Var CMD_ARGS

Section "Main"
  StrCpy $CACHE_ROOT "$LOCALAPPDATA\ZheQiMingSi\runtime"
  StrCpy $CACHE_DIR "$CACHE_ROOT\${BUILD_ID}"
  StrCpy $STAGE_DIR "$CACHE_ROOT\.stage-${BUILD_ID}"

  ; 热路径：版本缓存已就绪时直接零延迟启动（不调用 InitPluginsDir、不释放任何临时文件）
  IfFileExists "$CACHE_DIR\.ready" 0 NeedExtract
  IfFileExists "$CACHE_DIR\哲启明思.exe" LaunchApp NeedExtract

  NeedExtract:
    ; 并发保护：若用户在首次解压期间多次双击，后续进程安全等待首次解压完毕后直接拉起
    System::Call 'kernel32::CreateMutexW(p 0, i 1, t "Local\ZheQiMingSi_Extract_${BUILD_ID}") p .r0 ?e'
    Pop $1
    StrCpy $MUTEX_HANDLE $0
    ${If} $1 == 183
      System::Call 'kernel32::WaitForSingleObject(p $MUTEX_HANDLE, i 60000)'
      System::Call 'kernel32::ReleaseMutex(p $MUTEX_HANDLE)'
      System::Call 'kernel32::CloseHandle(p $MUTEX_HANDLE)'
      IfFileExists "$CACHE_DIR\哲启明思.exe" LaunchApp Done
    ${EndIf}

    ; 拿到互斥锁后二次检查，防止刚完成解压
    IfFileExists "$CACHE_DIR\.ready" 0 DoExtract
    IfFileExists "$CACHE_DIR\哲启明思.exe" ReleaseAndLaunch DoExtract

  DoExtract:
    InitPluginsDir
    CreateDirectory "$CACHE_ROOT"
    RMDir /r "$STAGE_DIR"
    CreateDirectory "$STAGE_DIR"

    ClearErrors
    File "/oname=$PLUGINSDIR\app-payload.7z" "${PAYLOAD_7Z}"
    SetOutPath "$STAGE_DIR"
    nsis7z::Extract "$PLUGINSDIR\app-payload.7z"
    Delete "$PLUGINSDIR\app-payload.7z"
    ; 必须先切出 $STAGE_DIR 工作目录，Windows 才允许原子 Rename 该目录
    SetOutPath "$CACHE_ROOT"

    IfFileExists "$STAGE_DIR\哲启明思.exe" 0 ExtractFailed
    RMDir /r "$CACHE_DIR"
    Rename "$STAGE_DIR" "$CACHE_DIR"
    IfFileExists "$CACHE_DIR\哲启明思.exe" 0 ExtractFailed

    FileOpen $2 "$CACHE_DIR\.ready" w
    FileWrite $2 "${BUILD_ID}"
    FileClose $2
    Goto ReleaseAndLaunch

  ExtractFailed:
    RMDir /r "$STAGE_DIR"
    ${If} $MUTEX_HANDLE != 0
      System::Call 'kernel32::ReleaseMutex(p $MUTEX_HANDLE)'
      System::Call 'kernel32::CloseHandle(p $MUTEX_HANDLE)'
    ${EndIf}
    MessageBox MB_OK|MB_ICONEXCLAMATION "哲启明思初始化运行环境失败，请检查系统盘剩余空间后重试。"
    Goto Done

  ReleaseAndLaunch:
    ${If} $MUTEX_HANDLE != 0
      System::Call 'kernel32::ReleaseMutex(p $MUTEX_HANDLE)'
      System::Call 'kernel32::CloseHandle(p $MUTEX_HANDLE)'
    ${EndIf}

  LaunchApp:
    ${GetParameters} $CMD_ARGS
    SetOutPath "$CACHE_DIR"
    ${If} $CMD_ARGS != ""
      Exec '"$CACHE_DIR\哲启明思.exe" $CMD_ARGS'
    ${Else}
      Exec '"$CACHE_DIR\哲启明思.exe"'
    ${EndIf}

  Done:
SectionEnd
