package com.klm.mix.hp;

import android.content.Context;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Penguat koneksi Wi-Fi untuk KLMCAM: selama kamera mengirim, Wi-Fi HP dikunci mode LATENSI RENDAH
 * (Android 10+: WIFI_MODE_FULL_LOW_LATENCY; lama: WIFI_MODE_FULL_HIGH_PERF) → hemat daya Wi-Fi mati, radio tidak
 * menahan-nahan paket (penyebab gambar telat / patah). info(): kekuatan sinyal, frekuensi & kecepatan link.
 */
@CapacitorPlugin(name = "KlmWifi")
public class WifiPlugin extends Plugin {
    private WifiManager.WifiLock lock;

    private WifiManager wm() { return (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE); }

    @PluginMethod
    public void start(PluginCall call) {
        JSObject o = new JSObject();
        try {
            if (lock == null) {
                int mode = Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
                lock = wm().createWifiLock(mode, "KLMCAM:wifi");
                lock.setReferenceCounted(false);
            }
            if (!lock.isHeld()) lock.acquire();
            o.put("locked", lock.isHeld());
            o.put("mode", Build.VERSION.SDK_INT >= 29 ? "low-latency" : "high-perf");
        } catch (Exception e) { o.put("locked", false); o.put("error", e.getMessage()); }
        call.resolve(o);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception e) {}
        JSObject o = new JSObject(); o.put("locked", false); call.resolve(o);
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        try {
            WifiInfo i = wm().getConnectionInfo();
            if (i != null && i.getNetworkId() != -1) {
                o.put("rssi", i.getRssi());
                o.put("freq", i.getFrequency());
                o.put("link", i.getLinkSpeed());
                if (Build.VERSION.SDK_INT >= 29) { o.put("tx", i.getTxLinkSpeedMbps()); o.put("rx", i.getRxLinkSpeedMbps()); }
            }
            o.put("locked", lock != null && lock.isHeld());
        } catch (Exception e) { o.put("error", e.getMessage()); }
        call.resolve(o);
    }

    @Override
    protected void handleOnDestroy() {
        try { if (lock != null && lock.isHeld()) lock.release(); } catch (Exception e) {}
        super.handleOnDestroy();
    }
}
