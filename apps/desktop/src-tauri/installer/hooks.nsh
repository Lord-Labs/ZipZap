!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\zipzap-desktop.exe" --register-native' $0
  ${If} $0 != 0
    DetailPrint "ZipZap browser registration failed; use Connect Chrome / Edge in settings."
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.zipzap.native"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.zipzap.native"
  Delete "$LOCALAPPDATA\com.zipzap.desktop\native-host.json"
!macroend
