; Keep the maintained Tauri template and native DPI/RTL/keyboard behavior.
SetFont "Segoe UI" 9
!define MUI_WELCOMEPAGE_TITLE "$(ZipZapWelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(ZipZapWelcomeText)"
!define MUI_FINISHPAGE_TITLE "$(ZipZapFinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(ZipZapFinishText)"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_INSTFILESPAGE_COLORS "14664D FFFFFF"

LangString ZipZapWelcomeTitle 1033 "Your downloads.$\r$\nReady in one setup."
LangString ZipZapWelcomeTitle 1025 "تنزيلاتك.$\r$\nجاهزة من تثبيت واحد."
LangString ZipZapWelcomeText 1033 "A smaller download. Automatic setup.$\r$\n$\r$\nZipZap, media tools and the browser extension are included. If WebView2 is missing, setup downloads it from Microsoft and installs it automatically. Internet is then required.$\r$\n$\r$\nExisting settings and downloads are kept.$\r$\n$\r$\nBrowser activation needs your approval."
LangString ZipZapWelcomeText 1025 "تحميل أصغر. تجهيز تلقائي.$\r$\n$\r$\nالتطبيق وأدوات الفيديو والإضافة مرفقة. عند غياب WebView2، ينزله المثبت من Microsoft ويثبته تلقائيًا؛ يلزم الإنترنت حينها.$\r$\n$\r$\nإعداداتك وتنزيلاتك السابقة محفوظة.$\r$\n$\r$\nتفعيل إضافة المتصفح يحتاج موافقتك."
LangString ZipZapFinishTitle 1033 "ZipZap is installed."
LangString ZipZapFinishTitle 1025 "اكتمل تثبيت ZipZap."
LangString ZipZapFinishText 1033 "Open ZipZap to start downloading.$\r$\nNew profiles are prepared; saved settings are kept.$\r$\nOptional: Settings > Browser extension setup. Activation needs your browser approval."
LangString ZipZapFinishText 1025 "افتح ZipZap وابدأ التنزيل.$\r$\nالملف الجديد مُجهّز؛ الإعدادات السابقة محفوظة.$\r$\nاختياريًا: الإعدادات ثم تجهيز إضافة المتصفح. تفعيلها يحتاج موافقة المتصفح."
LangString ZipZapPreparing 1033 "Preparing your language, Downloads folder and browser bridge..."
LangString ZipZapPreparing 1025 "جارٍ تجهيز اللغة ومجلد التنزيلات وجسر المتصفح..."
LangString ZipZapPrepared 1033 "Local setup complete. Browser extension activation is optional."
LangString ZipZapPrepared 1025 "اكتمل التجهيز المحلي. تفعيل إضافة المتصفح اختياري."
LangString ZipZapPrepareFailed 1033 "ZipZap files were installed, but automatic setup could not finish. Open the app and choose Settings > Set up ZipZap to retry folder/language setup and Connect Chrome / Edge to repair the bridge. Existing settings and downloads were kept."
LangString ZipZapPrepareFailed 1025 "ثُبّتت ملفات ZipZap، لكن تعذر إكمال التجهيز التلقائي. افتح التطبيق ثم الإعدادات وإعداد ZipZap لضبط المجلد واللغة، وربط Chrome / Edge لإصلاح الجسر. احتُفظ بالإعدادات والتنزيلات السابقة."

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "$(ZipZapPreparing)"
  StrCpy $1 "en"
  ${If} $LANGUAGE == 1025
    StrCpy $1 "ar"
  ${EndIf}
  ClearErrors
  ExecWait '"$INSTDIR\zipzap-desktop.exe" --prepare-install $1' $0
  ${If} ${Errors}
    StrCpy $0 1
  ${EndIf}
  ${If} $0 != 0
    DetailPrint "$(ZipZapPrepareFailed)"
    MessageBox MB_OK|MB_ICONEXCLAMATION "$(ZipZapPrepareFailed)" /SD IDOK
  ${Else}
    DetailPrint "$(ZipZapPrepared)"
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
