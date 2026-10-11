; Compile the bundled backend once, while the installer is already on screen.
; A failed compile does not fail the install: the first launch can still compile.
!macro customInstall
  DetailPrint "Compiling bundled backend modules"
  ExecWait '"$INSTDIR\resources\python\python.exe" -m compileall -q "$INSTDIR\resources\backend"' $0
  DetailPrint "compileall exit $0"
!macroend
