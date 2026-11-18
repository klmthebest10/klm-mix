package com.klm.mix.hp;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/** Update KLM HP dari dalam aplikasi: unduh APK baru (DownloadManager, ada progres) lalu buka penginstal Android. */
@CapacitorPlugin(name = "KlmUpdater")
public class UpdaterPlugin extends Plugin {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private long dlId = -1;

    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            o.put("version", pi.versionName);
            o.put("build", Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        } catch (Exception e) { o.put("version", ""); }
        o.put("canInstall", canInstall());
        call.resolve(o);
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    private File target() {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = getContext().getCacheDir();
        dir.mkdirs();
        return new File(dir, "KLM-HP-update.apk");
    }

    /** unduh APK; progres dikirim lewat event "progress" {percent, done, total}; selesai → resolve {path} */
    @PluginMethod(returnType = PluginMethod.RETURN_PROMISE)
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) { call.reject("url kosong"); return; }
        try {
            File f = target();
            if (f.exists()) f.delete();
            DownloadManager dm = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.setTitle("Update KLM HP");
            r.setDescription(call.getString("version", ""));
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
            r.setDestinationUri(Uri.fromFile(f));
            r.setMimeType("application/vnd.android.package-archive");
            dlId = dm.enqueue(r);
            final long id = dlId;
            ui.post(new Runnable() {
                @Override public void run() {
                    Cursor c = null;
                    try {
                        c = dm.query(new DownloadManager.Query().setFilterById(id));
                        if (c == null || !c.moveToFirst()) { call.reject("unduhan dibatalkan"); return; }
                        int st = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                        long done = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                        long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                        JSObject p = new JSObject();
                        p.put("done", done); p.put("total", total); p.put("percent", total > 0 ? (int) (done * 100 / total) : 0);
                        notifyListeners("progress", p);
                        if (st == DownloadManager.STATUS_SUCCESSFUL) { JSObject o = new JSObject(); o.put("path", f.getAbsolutePath()); call.resolve(o); return; }
                        if (st == DownloadManager.STATUS_FAILED) { call.reject("unduhan gagal (kode " + c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON)) + ")"); return; }
                        ui.postDelayed(this, 500);
                    } catch (Exception e) {
                        call.reject("unduhan gagal: " + e.getMessage());
                    } finally { if (c != null) c.close(); }
                }
            });
        } catch (Exception e) {
            call.reject("unduhan gagal: " + e.getMessage());
        }
    }

    /** buka penginstal Android untuk APK yang sudah diunduh. Bila izin "pasang aplikasi tak dikenal" belum ada → buka pengaturannya */
    @PluginMethod
    public void install(PluginCall call) {
        File f = target();
        JSObject o = new JSObject();
        if (!f.exists()) { call.reject("file update belum diunduh"); return; }
        if (!canInstall()) {
            try {
                Intent s = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(s);
            } catch (Exception e) {}
            o.put("needPermission", true);
            call.resolve(o);
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            o.put("started", true);
            call.resolve(o);
        } catch (Exception e) {
            call.reject("tidak bisa membuka penginstal: " + e.getMessage());
        }
    }

    /** cadangan: buka alamat di browser */
    @PluginMethod
    public void openUrl(PluginCall call) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(call.getString("url", "")));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }
}
