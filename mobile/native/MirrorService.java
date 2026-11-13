package com.klm.mix.hp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.view.Surface;
import android.view.WindowManager;
import java.io.BufferedOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Layanan latar depan: layar HP → VirtualDisplay → encoder H.264 hardware (MediaCodec, permukaan masukan) → TCP ke PC.
 * Protokol: "KLMM" u8 versi, u16 panjang, JSON salam; lalu paket [u8 tipe][u32 panjang][i64 ptsUs][data]
 * tipe 1 = SPS/PPS, 2 = frame kunci, 3 = frame biasa, 4 = info JSON. Perintah dari PC: 1 = minta frame kunci, 2 = berhenti, 3 = bitrate.
 */
public class MirrorService extends Service {
    static volatile MirrorService instance;
    static volatile String currentHost = "";

    private MediaProjection projection;
    private VirtualDisplay display;
    private MediaCodec codec;
    private Surface surface;
    private volatile Socket socket;
    private DataOutputStream out;
    private final Object outLock = new Object();
    private volatile boolean running;
    private volatile boolean reconfigure;
    private volatile boolean wantKey;
    private volatile int wantBitrate;
    private Thread worker;
    private String[] hosts = new String[0];
    private int port = 8624, size = 1280, fps = 60, bitrate = 8000;
    private String token = "", name = "";
    private int curW, curH, curDpi;
    private byte[] lastConfig;
    private String stopReason = "";
    private DisplayManager.DisplayListener displayListener;
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    public IBinder onBind(Intent intent) { return null; }

    boolean isRunning() { return running; }

    @Override
    public int onStartCommand(Intent in, int flags, int startId) {
        if (in == null) { stopSelf(); return START_NOT_STICKY; }
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
            else startForeground(7, n);
        } catch (Exception e) {
            MirrorPlugin.emit("error", "Layanan latar depan ditolak sistem: " + e.getMessage(), "", 0, 0, 0, 0);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (running) stopWork(); // mulai ulang dengan izin baru
        String[] hs = in.getStringArrayExtra("hosts");
        hosts = hs == null ? new String[0] : hs;
        port = in.getIntExtra("port", 8624);
        token = safe(in.getStringExtra("token"));
        size = clamp(in.getIntExtra("size", 1280), 480, 2560);
        fps = clamp(in.getIntExtra("fps", 60), 10, 60);
        bitrate = clamp(in.getIntExtra("bitrate", 8000), 500, 40000);
        name = safe(in.getStringExtra("name"));
        int code = in.getIntExtra("code", 0);
        Intent data = Build.VERSION.SDK_INT >= 33 ? in.getParcelableExtra("data", Intent.class) : (Intent) in.getParcelableExtra("data");
        MediaProjectionManager m = (MediaProjectionManager) getSystemService(Context.MEDIA_PROJECTION_SERVICE);
        try {
            projection = (m == null || data == null) ? null : m.getMediaProjection(code, data);
        } catch (Exception e) { projection = null; }
        if (projection == null) {
            MirrorPlugin.emit("error", "Izin rekam layar tidak berlaku — coba lagi", "", 0, 0, 0, 0);
            stopForegroundCompat(); stopSelf();
            return START_NOT_STICKY;
        }
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() { shutdown("Perekaman layar dihentikan dari sistem"); }
        }, main);
        instance = this;
        running = true; stopReason = "";
        worker = new Thread(this::run, "klm-mirror");
        worker.start();
        return START_NOT_STICKY;
    }

    void shutdown(String reason) {
        if (!running) return;
        stopReason = reason == null ? "" : reason;
        running = false;
        Socket s = socket;
        if (s != null) { try { s.close(); } catch (IOException e) { /* abaikan */ } }
        Thread w = worker;
        if (w != null) w.interrupt();
    }

    private void stopWork() {
        running = false;
        Socket s = socket;
        if (s != null) { try { s.close(); } catch (IOException e) { /* abaikan */ } }
        Thread w = worker;
        if (w != null) { w.interrupt(); try { w.join(1500); } catch (InterruptedException e) { /* abaikan */ } }
    }

    // ---------------- thread kerja ----------------
    private void run() {
        String error = null;
        try {
            computeSize();
            startEncoder();
            displayListener = new DisplayManager.DisplayListener() {
                @Override public void onDisplayAdded(int id) { }
                @Override public void onDisplayRemoved(int id) { }
                @Override public void onDisplayChanged(int id) { if (id == 0) reconfigure = true; } // rotasi layar
            };
            DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            if (dm != null) dm.registerDisplayListener(displayListener, main);
            int fails = 0;
            while (running) {
                try {
                    MirrorPlugin.emit("connecting", "", currentHost, curW, curH, fps, 0);
                    connect();
                    fails = 0;
                    pump();
                } catch (IOException e) {
                    closeSocket();
                    if (!running) break;
                    if (++fails > 15) { error = "Sambungan ke PC terputus: " + e.getMessage(); break; }
                    try { Thread.sleep(Math.min(400L * fails, 2000L)); } catch (InterruptedException ie) { break; }
                }
            }
        } catch (Throwable e) {
            error = e.getClass().getSimpleName() + ": " + e.getMessage();
        } finally {
            running = false;
            DisplayManager dm = (DisplayManager) getSystemService(Context.DISPLAY_SERVICE);
            if (dm != null && displayListener != null) { try { dm.unregisterDisplayListener(displayListener); } catch (Exception e) { /* abaikan */ } }
            closeSocket();
            releaseEncoder();
            if (display != null) { try { display.release(); } catch (Exception e) { /* abaikan */ } display = null; }
            if (projection != null) { try { projection.stop(); } catch (Exception e) { /* abaikan */ } projection = null; }
            if (instance == this) instance = null;
            MirrorPlugin.emit(error != null ? "error" : "stopped", error != null ? error : stopReason, currentHost, 0, 0, 0, 0);
            main.post(() -> { stopForegroundCompat(); stopSelf(); });
        }
    }

    private void connect() throws IOException {
        IOException last = new IOException("alamat PC kosong");
        for (String h : hosts) {
            if (!running) throw new IOException("dihentikan");
            Socket s = new Socket();
            try {
                s.connect(new InetSocketAddress(h, port), 2500);
                s.setTcpNoDelay(true);
                s.setSendBufferSize(512 * 1024);
                s.setKeepAlive(true);
                DataOutputStream o = new DataOutputStream(new BufferedOutputStream(s.getOutputStream(), 128 * 1024));
                JSONObject j = new JSONObject();
                try {
                    j.put("token", token); j.put("name", name.isEmpty() ? Build.MODEL : name); j.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                    j.put("w", curW); j.put("h", curH); j.put("fps", fps); j.put("android", Build.VERSION.SDK_INT);
                } catch (Exception e) { /* abaikan */ }
                byte[] jb = j.toString().getBytes(StandardCharsets.UTF_8);
                o.write(new byte[] { 'K', 'L', 'M', 'M', 1 });
                o.writeShort(jb.length);
                o.write(jb);
                o.flush();
                synchronized (outLock) { socket = s; out = o; }
                currentHost = h;
                final InputStream in = s.getInputStream();
                Thread r = new Thread(() -> readCommands(s, in), "klm-mirror-cmd");
                r.setDaemon(true);
                r.start();
                byte[] cfg = lastConfig;
                if (cfg != null) send(1, 0, cfg, cfg.length);
                wantKey = true;
                return;
            } catch (IOException e) {
                last = e;
                try { s.close(); } catch (IOException e2) { /* abaikan */ }
            }
        }
        throw new IOException("PC tidak ditemukan (" + last.getMessage() + ")");
    }

    private void readCommands(Socket s, InputStream in) {
        try {
            byte[] four = new byte[4];
            while (running && socket == s) {
                int c = in.read();
                if (c < 0) break;
                if (c == 1) wantKey = true;
                else if (c == 2) { shutdown("Dihentikan dari PC"); return; }
                else if (c == 3) {
                    int got = 0;
                    while (got < 4) { int k = in.read(four, got, 4 - got); if (k < 0) return; got += k; }
                    wantBitrate = ByteBuffer.wrap(four).getInt();
                }
            }
        } catch (IOException e) { /* soket ditutup */ }
        if (socket == s) { try { s.close(); } catch (IOException e) { /* abaikan */ } } // bangunkan pump() agar menyambung ulang
    }

    private void pump() throws IOException {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        long statAt = System.currentTimeMillis();
        long bytes = 0;
        int frames = 0;
        byte[] buf = new byte[256 * 1024];
        while (running) {
            Socket s = socket;
            if (s == null || s.isClosed()) throw new IOException("soket tertutup");
            if (reconfigure) { reconfigure = false; if (sizeChanged()) restartEncoder(); }
            if (wantKey) { wantKey = false; Bundle b = new Bundle(); b.putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0); try { codec.setParameters(b); } catch (Exception e) { /* abaikan */ } }
            if (wantBitrate > 0) { Bundle b = new Bundle(); b.putInt(MediaCodec.PARAMETER_KEY_VIDEO_BITRATE, clamp(wantBitrate, 300, 40000) * 1000); wantBitrate = 0; try { codec.setParameters(b); } catch (Exception e) { /* abaikan */ } }
            int idx;
            try { idx = codec.dequeueOutputBuffer(info, 20000); } catch (IllegalStateException e) { throw new IOException("encoder berhenti"); }
            if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                MediaFormat f = codec.getOutputFormat();
                ByteBuffer sps = f.getByteBuffer("csd-0"), pps = f.getByteBuffer("csd-1");
                if (sps != null) {
                    int n = sps.remaining() + (pps == null ? 0 : pps.remaining());
                    byte[] cfg = new byte[n];
                    int a = sps.remaining();
                    sps.duplicate().get(cfg, 0, a);
                    if (pps != null) pps.duplicate().get(cfg, a, pps.remaining());
                    lastConfig = cfg;
                    send(1, 0, cfg, cfg.length);
                }
            } else if (idx >= 0) {
                ByteBuffer b = codec.getOutputBuffer(idx);
                int n = info.size;
                if (b != null && n > 0) {
                    if (buf.length < n) buf = new byte[n + 64 * 1024];
                    b.position(info.offset);
                    b.limit(info.offset + n);
                    b.get(buf, 0, n);
                    boolean cfg = (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0;
                    boolean key = (info.flags & MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0;
                    if (cfg) { byte[] c = new byte[n]; System.arraycopy(buf, 0, c, 0, n); lastConfig = c; }
                    send(cfg ? 1 : key ? 2 : 3, info.presentationTimeUs, buf, n);
                    if (!cfg) { frames++; bytes += n; }
                }
                codec.releaseOutputBuffer(idx, false);
                if ((info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) throw new IOException("encoder selesai");
            }
            long now = System.currentTimeMillis();
            if (now - statAt >= 1000) {
                MirrorPlugin.emit("live", "", currentHost, curW, curH, (int) (frames * 1000L / (now - statAt)), (int) (bytes * 8 / (now - statAt)));
                statAt = now; bytes = 0; frames = 0;
            }
        }
    }

    private void send(int type, long ptsUs, byte[] data, int len) throws IOException {
        synchronized (outLock) {
            DataOutputStream o = out;
            if (o == null) throw new IOException("belum tersambung");
            o.writeByte(type);
            o.writeInt(len);
            o.writeLong(ptsUs);
            o.write(data, 0, len);
            o.flush();
        }
    }

    private void closeSocket() {
        synchronized (outLock) {
            if (socket != null) { try { socket.close(); } catch (IOException e) { /* abaikan */ } }
            socket = null; out = null;
        }
    }

    // ---------------- encoder ----------------
    private int[] measure() {
        DisplayMetrics dm = new DisplayMetrics();
        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        wm.getDefaultDisplay().getRealMetrics(dm);
        int w = dm.widthPixels, h = dm.heightPixels;
        float sc = Math.min(1f, (float) size / Math.max(w, h));
        int ew = Math.max(160, Math.round(w * sc) & ~7), eh = Math.max(160, Math.round(h * sc) & ~7);
        return new int[] { ew, eh, dm.densityDpi };
    }

    private void computeSize() { int[] m = measure(); curW = m[0]; curH = m[1]; curDpi = m[2]; }

    private boolean sizeChanged() { int[] m = measure(); return m[0] != curW || m[1] != curH; }

    private void startEncoder() throws IOException {
        MediaFormat f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, curW, curH);
        f.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
        f.setInteger(MediaFormat.KEY_BIT_RATE, bitrate * 1000);
        f.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
        f.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2);
        f.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100000L); // layar diam tetap terkirim
        if (Build.VERSION.SDK_INT >= 23) f.setInteger(MediaFormat.KEY_PRIORITY, 0); // waktu nyata
        if (Build.VERSION.SDK_INT >= 26) f.setInteger(MediaFormat.KEY_LATENCY, 0);
        MediaCodec c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
        try {
            c.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        } catch (Exception e) { // encoder lama menolak kunci tambahan → konfigurasi dasar
            c.release();
            c = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC);
            MediaFormat g = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, curW, curH);
            g.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
            g.setInteger(MediaFormat.KEY_BIT_RATE, bitrate * 1000);
            g.setInteger(MediaFormat.KEY_FRAME_RATE, Math.min(fps, 30));
            g.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2);
            g.setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100000L);
            c.configure(g, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
        }
        surface = c.createInputSurface();
        c.start();
        codec = c;
        if (display == null) display = projection.createVirtualDisplay("KLM Mix Mirror", curW, curH, curDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, null, null);
        else { display.resize(curW, curH, curDpi); display.setSurface(surface); }
    }

    private void releaseEncoder() {
        if (display != null) { try { display.setSurface(null); } catch (Exception e) { /* abaikan */ } }
        if (codec != null) {
            try { codec.stop(); } catch (Exception e) { /* abaikan */ }
            try { codec.release(); } catch (Exception e) { /* abaikan */ }
            codec = null;
        }
        if (surface != null) { try { surface.release(); } catch (Exception e) { /* abaikan */ } surface = null; }
    }

    private void restartEncoder() throws IOException {
        releaseEncoder();
        computeSize();
        lastConfig = null;
        startEncoder();
        try {
            byte[] j = new JSONObject().put("w", curW).put("h", curH).toString().getBytes(StandardCharsets.UTF_8);
            send(4, 0, j, j.length);
        } catch (org.json.JSONException e) { /* abaikan */ }
    }

    // ---------------- lain-lain ----------------
    private Notification buildNotification() {
        String ch = "klm_mirror";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(ch) == null) nm.createNotificationChannel(new NotificationChannel(ch, "Mirroring layar", NotificationManager.IMPORTANCE_LOW));
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, ch) : new Notification.Builder(this);
        return b.setContentTitle("KLM Mix — Mirroring layar").setContentText("Layar HP ini sedang dikirim ke KLM Mix di PC").setSmallIcon(getApplicationInfo().icon).setOngoing(true).build();
    }

    private void stopForegroundCompat() {
        try {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE); else stopForeground(true);
        } catch (Exception e) { /* abaikan */ }
    }

    @Override
    public void onDestroy() {
        running = false;
        closeSocket();
        if (instance == this) instance = null;
        super.onDestroy();
    }

    private static String safe(String s) { return s == null ? "" : s; }

    private static int clamp(int v, int a, int b) { return Math.max(a, Math.min(b, v)); }
}
