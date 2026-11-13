package com.klm.mix.hp;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/** Jembatan JS ↔ layanan Mirroring layar (MediaProjection + encoder H.264 hardware → TCP ke KLM Mix di PC). */
@CapacitorPlugin(name = "KlmMirror")
public class MirrorPlugin extends Plugin {
    static volatile MirrorPlugin instance;
    static volatile String launchUrl;

    @Override
    public void load() { instance = this; }

    static void emit(String state, String message, String host, int w, int h, int fps, int kbps) {
        MirrorPlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("state", state);
        o.put("message", message == null ? "" : message);
        o.put("host", host == null ? "" : host);
        o.put("w", w); o.put("h", h); o.put("fps", fps); o.put("kbps", kbps);
        p.notifyListeners("state", o);
    }

    static void link(String url) {
        launchUrl = url;
        MirrorPlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("url", url);
        p.notifyListeners("link", o);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT < 26) { call.reject("Mirroring butuh Android 8 atau lebih baru"); return; }
        MediaProjectionManager m = (MediaProjectionManager) getContext().getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        if (m == null) { call.reject("Perangkat tidak mendukung rekam layar"); return; }
        startActivityForResult(call, m.createScreenCaptureIntent(), "onProjection");
    }

    @ActivityCallback
    private void onProjection(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("Izin rekam layar tidak diberikan"); return; }
        List<String> hosts = new ArrayList<>();
        try {
            JSArray a = call.getArray("hosts");
            if (a != null) for (int i = 0; i < a.length(); i++) { String s = a.optString(i, "").trim(); if (!s.isEmpty()) hosts.add(s); }
        } catch (Exception e) { /* abaikan */ }
        if (hosts.isEmpty()) { call.reject("Alamat PC kosong"); return; }
        Intent i = new Intent(getContext(), MirrorService.class);
        i.putExtra("code", result.getResultCode());
        i.putExtra("data", result.getData());
        i.putExtra("hosts", hosts.toArray(new String[0]));
        i.putExtra("port", call.getInt("port", 8624));
        i.putExtra("token", call.getString("token", ""));
        i.putExtra("size", call.getInt("size", 1280));
        i.putExtra("fps", call.getInt("fps", 60));
        i.putExtra("bitrate", call.getInt("bitrate", 8000));
        i.putExtra("name", call.getString("name", ""));
        try {
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
            call.resolve();
        } catch (Exception e) { call.reject("Layanan mirroring gagal dimulai: " + e.getMessage()); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        MirrorService s = MirrorService.instance;
        if (s != null) s.shutdown("Dihentikan");
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject o = new JSObject();
        MirrorService s = MirrorService.instance;
        o.put("running", s != null && s.isRunning());
        o.put("host", MirrorService.currentHost);
        call.resolve(o);
    }

    @PluginMethod
    public void getLaunchUrl(PluginCall call) {
        JSObject o = new JSObject();
        o.put("url", launchUrl == null ? "" : launchUrl);
        if (Boolean.TRUE.equals(call.getBoolean("consume", false))) launchUrl = null;
        call.resolve(o);
    }
}
