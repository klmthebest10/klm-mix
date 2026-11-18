; KLM - izinkan koneksi dari HP (KLMCAM / Remote / Mirroring) dan iPhone (AirPlay) di Windows Firewall
!macro customInstall
  ; aturan lama (nama aplikasi sebelumnya "KLM Mix") dibersihkan
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM Mix AirPlay"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="KLM" dir=in action=allow program="$INSTDIR\${PRODUCT_FILENAME}.exe" enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM AirPlay"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="KLM AirPlay" dir=in action=allow program="$INSTDIR\resources\airplay\klm-airplay.exe" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="KLM AirPlay"'
!macroend
