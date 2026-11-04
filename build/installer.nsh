; KLM Mix - izinkan koneksi dari HP (KLMCAM / Remote) di Windows Firewall
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="KLM Mix" dir=in action=allow program="$INSTDIR\KLM Mix.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix"'
!macroend
