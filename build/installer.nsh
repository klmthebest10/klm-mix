; KLM Mix - izinkan koneksi dari HP (KLMCAM / Remote / Mirroring) dan iPhone (AirPlay) di Windows Firewall
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="KLM Mix" dir=in action=allow program="$INSTDIR\KLM Mix.exe" enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix AirPlay"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="KLM Mix AirPlay" dir=in action=allow program="$INSTDIR\resources\airplay\klm-airplay.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix AirPlay"'
!macroend
