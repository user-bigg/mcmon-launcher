!include LogicLib.nsh
!include WinMessages.nsh
!include getProcessInfo.nsh

!define MCMONITOR_PROTOCOL_KEY "Software\Classes\mcmonitor"
!define MCMONITOR_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define MCMONITOR_RUN_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define MCMONITOR_RUN_VALUE "MCMonitorLauncher"

Var pid
Var IsPowerShellAvailable

; electron-builder looks for a running launcher with PowerShell and WMI, starting PowerShell three
; times: on a slow computer that is the longest step of the install. Its own fallback without
; PowerShell (tasklist and taskkill for the current user) checks the same much faster.
!macro customCheckAppRunning
  StrCpy $IsPowerShellAvailable 1
  !insertmacro _CHECK_APP_RUNNING
!macroend

!ifndef BUILD_UNINSTALLER
!include installer-ru.nsh
!define MCMONITOR_PHRASE_MS 3500
!define MCMONITOR_LAST_PHRASE_AFTER_MS 1500

Var mcmonitorPhraseLabel

; NSIS has no timer and the install thread is busy in long steps (the app check, removing the old
; version), so the phrases change in a thread of our own plugin (build/nsis-plugin/phrases.c).
!macro customInstallingLabel LABEL
  StrCpy $mcmonitorPhraseLabel ${LABEL}
  SendMessage $mcmonitorPhraseLabel ${WM_SETTEXT} 0 "STR:${MCMONITOR_PHRASE_FIRST}"
  McmPhrases::Start $mcmonitorPhraseLabel ${MCMONITOR_PHRASE_MS} 8 \
    "${MCMONITOR_PHRASE_1}" "${MCMONITOR_PHRASE_2}" "${MCMONITOR_PHRASE_3}" "${MCMONITOR_PHRASE_4}" \
    "${MCMONITOR_PHRASE_5}" "${MCMONITOR_PHRASE_6}" "${MCMONITOR_PHRASE_7}" "${MCMONITOR_PHRASE_8}"
!macroend

!macro customExtract7za FILE
  Nsis7z::Extract "${FILE}"
  ${IfNot} ${Silent}
    McmPhrases::Finish ${MCMONITOR_LAST_PHRASE_AFTER_MS} "${MCMONITOR_PHRASE_LAST}"
  ${EndIf}
!macroend
!endif

; electron-builder registers protocols only on macOS and in appx, so the installer writes the key
; itself and the link works before the first launch. The command matches what
; app.setAsDefaultProtocolClient writes: Electron quotes only arguments with spaces or backslashes.
!macro customInstall
  WriteRegStr SHCTX "${MCMONITOR_PROTOCOL_KEY}" "" "URL:mcmonitor"
  WriteRegStr SHCTX "${MCMONITOR_PROTOCOL_KEY}" "URL Protocol" ""
  WriteRegStr SHCTX "${MCMONITOR_PROTOCOL_KEY}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" -- "%1"'
!macroend

; The key is removed only when its command starts with our executable, so a registration made by
; another installation or another app survives; the prefix check also accepts older commands
; written without "--".
!macro mcmonitorRemoveProtocol ROOT
  Push $0
  Push $1
  Push $2
  ReadRegStr $0 ${ROOT} "${MCMONITOR_PROTOCOL_KEY}\shell\open\command" ""
  StrCpy $1 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  StrLen $2 $1
  StrCpy $0 $0 $2
  ${if} $0 == $1
    DeleteRegKey ${ROOT} "${MCMONITOR_PROTOCOL_KEY}"
  ${endIf}
  Pop $2
  Pop $1
  Pop $0
!macroend

; The launcher registers itself in HKCU on every start, so both roots are checked. An update runs
; this uninstaller before the new installer, which writes the key again, so the key is kept.
; The start with Windows is written by the launcher itself (app.setLoginItemSettings, the value
; name is LOGIN_ITEM_NAME in src/main/autostart.ts). An update keeps it: the path stays the same.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    !insertmacro mcmonitorRemoveProtocol SHCTX
    !insertmacro mcmonitorRemoveProtocol HKCU
    DeleteRegValue HKCU "${MCMONITOR_RUN_KEY}" "${MCMONITOR_RUN_VALUE}"
    DeleteRegValue HKCU "${MCMONITOR_RUN_APPROVED_KEY}" "${MCMONITOR_RUN_VALUE}"
  ${endIf}
!macroend
