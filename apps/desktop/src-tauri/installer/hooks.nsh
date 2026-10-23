!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\zipzap-desktop.exe" --register-native' $0
  ${If} $0 != 0
    DetailPrint "ZipZap browser registration failed; use Connect Chrome / Edge in settings."
    ${If} $LANGUAGE == 1025
      MessageBox MB_OK|MB_ICONEXCLAMATION "اكتمل تثبيت ZipZap، لكن تعذر تسجيل ربط المتصفح. افتح التطبيق ثم الإعدادات واختر ربط Chrome / Edge لإعادة المحاولة. التنزيل اليدوي متاح." /SD IDOK
    ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION "ZipZap was installed, but browser registration failed. Open Settings and choose Connect Chrome / Edge to retry. Manual downloads remain available." /SD IDOK
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  InitPluginsDir
  CopyFiles /SILENT "$INSTDIR\zipzap-native.exe" "$PLUGINSDIR\zipzap-unregister.exe"
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} ${FileExists} "$PLUGINSDIR\zipzap-unregister.exe"
    ExecWait '"$PLUGINSDIR\zipzap-unregister.exe" --unregister-native "$INSTDIR\zipzap-native.exe"' $0
    ${If} $0 != 0
      DetailPrint "ZipZap could not remove its native registration; other installations and user data were retained."
    ${EndIf}
  ${EndIf}
!macroend
