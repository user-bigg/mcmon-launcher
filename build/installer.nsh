!define MCMONITOR_PROTOCOL_KEY "Software\Classes\mcmonitor"
!define MCMONITOR_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define MCMONITOR_RUN_APPROVED_KEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
!define MCMONITOR_RUN_VALUE "MCMonitorLauncher"

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
