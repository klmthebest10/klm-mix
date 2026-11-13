/*
 * klm-airplay — penerima AirPlay Mirroring untuk KLM Mix (iPhone / iPad / Mac → "Screen Mirroring", tanpa aplikasi).
 *
 * Program kecil ini memakai pustaka AirPlay dari proyek UxPlay (https://github.com/FDH2/UxPlay, GPL-3.0) dan karena itu
 * dilisensikan GPL-3.0-or-later. Ia berjalan sebagai proses terpisah dari KLM Mix: menerima layar perangkat Apple,
 * lalu meneruskan video H.264 (sudah didekripsi) ke port Mirroring KLM Mix lewat TCP lokal dengan protokol:
 *   "KLMM" u8 versi, u16 panjang, JSON {token,name,model,w,h,fps}; lalu paket [u8 tipe][u32 panjang][i64 ptsUs][data]
 *   tipe 1 = SPS/PPS, 2 = frame kunci, 3 = frame biasa.
 * Status dicetak ke stdout sebagai baris JSON untuk dibaca KLM Mix.
 *
 * uji  : klm-airplay --port 8624 --token <hex> --selftest video.h264 [detik]
 * pakai: klm-airplay --name "KLM Mix" --port 8624 --token <hex> --mac AA:BB:CC:DD:EE:FF --keyfile <path> [--fps 60] [--debug]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <signal.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
typedef SOCKET sock_t;
#define SOCK_BAD INVALID_SOCKET
#define sock_close closesocket
#define msleep(ms) Sleep(ms)
#else
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
typedef int sock_t;
#define SOCK_BAD (-1)
#define sock_close close
#define msleep(ms) usleep((ms) * 1000)
#endif
#include <pthread.h>

#include "raop.h"
#include "dnssd.h"
#include "logger.h"
#include "stream.h"

static char g_name[128] = "KLM Mix";
static char g_token[64] = "";
static char g_mac[32] = "";
static char g_keyfile[1024] = "";
static int g_port = 8624, g_fps = 60, g_debug = 0, g_w = 1920, g_h = 1080;

static raop_t *raop = NULL;
static dnssd_t *dnssd = NULL;
static volatile int running = 1, reset_req = 0, open_conns = 0, missed = 0;

static pthread_mutex_t out_mx = PTHREAD_MUTEX_INITIALIZER;
static sock_t out_sock = SOCK_BAD;
static char client_name[160] = "", client_model[96] = "";
static int vid_w = 0, vid_h = 0, need_cfg = 1;
static uint64_t pts0 = 0, frames = 0;

/* ---------- status ke KLM Mix ---------- */
static void jesc(const char *s, char *o, size_t n) {
    size_t k = 0;
    for (; *s && k + 7 < n; s++) {
        unsigned char c = (unsigned char) *s;
        if (c == '"' || c == '\\') { o[k++] = '\\'; o[k++] = (char) c; }
        else if (c < 0x20) { k += (size_t) snprintf(o + k, n - k, "\\u%04x", c); }
        else o[k++] = (char) c;
    }
    o[k] = 0;
}
static void status(const char *ev, const char *msg) {
    char a[400], b[240], c[400];
    jesc(client_name, a, sizeof a); jesc(client_model, b, sizeof b); jesc(msg ? msg : "", c, sizeof c);
    printf("{\"ev\":\"%s\",\"name\":\"%s\",\"model\":\"%s\",\"w\":%d,\"h\":%d,\"msg\":\"%s\"}\n", ev, a, b, vid_w, vid_h, c);
    fflush(stdout);
}

/* ---------- sambungan keluar ke KLM Mix ---------- */
static int send_all(sock_t s, const void *p, int n) {
    const char *c = (const char *) p;
    while (n > 0) {
        int w = (int) send(s, c, n, 0);
        if (w <= 0) return -1;
        c += w; n -= w;
    }
    return 0;
}
static void out_close_locked(void) {
    if (out_sock != SOCK_BAD) { sock_close(out_sock); out_sock = SOCK_BAD; }
    need_cfg = 1;
}
static int out_open_locked(void) {
    if (out_sock != SOCK_BAD) return 0;
    sock_t s = socket(AF_INET, SOCK_STREAM, 0);
    if (s == SOCK_BAD) return -1;
    struct sockaddr_in a;
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET; a.sin_port = htons((unsigned short) g_port); a.sin_addr.s_addr = htonl(0x7f000001);
    if (connect(s, (struct sockaddr *) &a, sizeof a) != 0) { sock_close(s); return -1; }
    int one = 1; setsockopt(s, IPPROTO_TCP, TCP_NODELAY, (const char *) &one, sizeof one);
    char n1[400], n2[240], js[1100];
    jesc(client_name[0] ? client_name : "Perangkat Apple", n1, sizeof n1); jesc(client_model, n2, sizeof n2);
    int jl = snprintf(js, sizeof js, "{\"token\":\"%s\",\"name\":\"%s\",\"model\":\"%s\",\"w\":%d,\"h\":%d,\"fps\":%d,\"airplay\":true}", g_token, n1, n2, vid_w, vid_h, g_fps);
    unsigned char hd[7] = { 'K', 'L', 'M', 'M', 1, (unsigned char) (jl >> 8), (unsigned char) (jl & 255) };
    if (send_all(s, hd, 7) || send_all(s, js, jl)) { sock_close(s); return -1; }
    out_sock = s; need_cfg = 1; pts0 = 0;
    return 0;
}
static int out_packet_locked(int type, uint64_t pts_us, const unsigned char *d, int n) {
    unsigned char h[13];
    h[0] = (unsigned char) type;
    h[1] = (unsigned char) (n >> 24); h[2] = (unsigned char) (n >> 16); h[3] = (unsigned char) (n >> 8); h[4] = (unsigned char) n;
    for (int i = 0; i < 8; i++) h[5 + i] = (unsigned char) (pts_us >> (56 - 8 * i));
    if (send_all(out_sock, h, 13) || (n > 0 && send_all(out_sock, d, n))) { out_close_locked(); return -1; }
    return 0;
}

/* ---------- callback pustaka AirPlay ---------- */
static void cb_video_process(void *cls, raop_ntp_t *ntp, video_decode_struct *data) {
    (void) cls; (void) ntp;
    if (!data || !data->data || data->data_len < 5 || data->is_h265) return;
    const unsigned char *p = data->data; int n = data->data_len;
    /* pisahkan NAL (kode awal 00 00 00 01): SPS/PPS → paket konfigurasi; sisanya → frame */
    int cfg_end = 0, key = 0, i = 0;
    while (i + 4 < n) {
        if (p[i] == 0 && p[i + 1] == 0 && p[i + 2] == 0 && p[i + 3] == 1) {
            int t = p[i + 4] & 0x1f;
            int j = i + 4;
            while (j + 3 < n && !(p[j] == 0 && p[j + 1] == 0 && p[j + 2] == 0 && p[j + 3] == 1)) j++;
            if (j + 3 >= n) j = n;
            if ((t == 7 || t == 8) && i == cfg_end) cfg_end = j; /* SPS/PPS di depan */
            if (t == 5) key = 1;
            i = j;
        } else i++;
    }
    pthread_mutex_lock(&out_mx);
    if (out_open_locked() == 0) {
        if (!pts0) pts0 = data->ntp_time_remote;
        uint64_t pts = (data->ntp_time_remote - pts0) / 1000ULL;
        int ok = 0;
        if (cfg_end > 0) { ok = out_packet_locked(1, 0, p, cfg_end); if (!ok) need_cfg = 0; }
        if (!ok && n > cfg_end && !(need_cfg && !key)) ok = out_packet_locked(key ? 2 : 3, pts, p + cfg_end, n - cfg_end);
        if (!ok) frames++;
    }
    pthread_mutex_unlock(&out_mx);
}
static void cb_audio_process(void *cls, raop_ntp_t *ntp, audio_decode_struct *data) { (void) cls; (void) ntp; (void) data; /* suara belum diteruskan */ }
static void cb_noop(void *cls) { (void) cls; }
static void cb_conn_init(void *cls) { (void) cls; open_conns++; missed = 0; }
static void cb_conn_destroy(void *cls) {
    (void) cls;
    if (open_conns > 0) open_conns--;
    if (open_conns == 0) { pthread_mutex_lock(&out_mx); out_close_locked(); pthread_mutex_unlock(&out_mx); vid_w = vid_h = 0; status("idle", ""); }
}
static void cb_conn_feedback(void *cls) { (void) cls; missed = 0; }
static void cb_conn_reset(void *cls, int reason) { (void) cls; status("lost", reason == 1 ? "sambungan ke perangkat terputus" : "sumber tidak didukung"); reset_req = 1; }
static void cb_video_reset(void *cls, reset_type_t type) {
    (void) cls; (void) type;
    pthread_mutex_lock(&out_mx); out_close_locked(); pthread_mutex_unlock(&out_mx);
    status("stopped", "");
}
static int cb_video_size(void *cls, video_codec_t codec, unsigned short ws, unsigned short hs, unsigned short xo, unsigned short yo, unsigned short w, unsigned short h) {
    (void) cls; (void) xo; (void) yo; (void) w; (void) h;
    if (codec == VIDEO_CODEC_H265) { status("error", "perangkat mengirim H.265 (tidak didukung)"); return -1; }
    if (ws != vid_w || hs != vid_h) {
        vid_w = ws; vid_h = hs;
        pthread_mutex_lock(&out_mx);
        if (out_sock != SOCK_BAD) { char js[96]; int jl = snprintf(js, sizeof js, "{\"w\":%d,\"h\":%d}", vid_w, vid_h); out_packet_locked(4, 0, (const unsigned char *) js, jl); }
        pthread_mutex_unlock(&out_mx);
        status("video", "");
    }
    return 0;
}
static double cb_client_volume(void *cls) { (void) cls; return 0.0; }
static void cb_set_volume(void *cls, float v) { (void) cls; (void) v; }
static void cb_buf(void *cls, const void *b, int n) { (void) cls; (void) b; (void) n; }
static void cb_remote_id(void *cls, const char *a, const char *b) { (void) cls; (void) a; (void) b; }
static void cb_progress(void *cls, uint32_t *a, uint32_t *b, uint32_t *c) { (void) cls; (void) a; (void) b; (void) c; }
static void cb_audio_format(void *cls, unsigned char *ct, unsigned short *spf, bool *us, bool *im, uint64_t *af) { (void) cls; (void) ct; (void) spf; (void) us; (void) im; (void) af; }
static void cb_mirror_running(void *cls, bool on) { (void) cls; status(on ? "mirror" : "mirror-off", ""); }
static void cb_client_request(void *cls, char *deviceid, char *model, char *name, bool *admit) {
    (void) cls; (void) deviceid;
    snprintf(client_name, sizeof client_name, "%s", name ? name : "");
    snprintf(client_model, sizeof client_model, "%s", model ? model : "");
    *admit = true;
    status("client", "");
}
static void cb_display_pin(void *cls, char *pin) { (void) cls; status("pin", pin ? pin : ""); }
static void cb_register_client(void *cls, const char *a, const char *b, const char *c) { (void) cls; (void) a; (void) b; (void) c; }
static bool cb_check_register(void *cls, const char *pk) { (void) cls; (void) pk; return true; }
static const char *cb_passwd(void *cls, int *len) { (void) cls; *len = 0; return NULL; }
static void cb_export_dacp(void *cls, const char *a, const char *b) { (void) cls; (void) a; (void) b; }
static void cb_play(void *cls, const char *loc, const float pos) { (void) cls; (void) loc; (void) pos; }
static void cb_float(void *cls, const float v) { (void) cls; (void) v; }
static void cb_playback_info(void *cls, playback_info_t *i) { (void) cls; (void) i; }
static float cb_playlist_remove(void *cls) { (void) cls; return 0.0f; }
static void cb_custom_profile(void *cls, const char **p) { (void) cls; if (p) *p = NULL; }
static void cb_log(void *cls, int level, const char *msg) {
    (void) cls;
    if (level <= LOGGER_WARNING || g_debug) fprintf(stderr, "[airplay] %s\n", msg);
}

static void on_signal(int s) { (void) s; running = 0; }

/* --selftest <file.h264>: tanpa perangkat Apple — membaca H.264 Annex-B, menyusunnya seperti keluaran pustaka AirPlay
 * (SPS/PPS di depan frame IDR, kode awal 4 byte) lalu memanggil callback yang sama. Untuk uji otomatis (CI). */
static int selftest(const char *file, int seconds) {
    FILE *f = fopen(file, "rb");
    if (!f) { fprintf(stderr, "selftest: file tidak bisa dibuka\n"); return 7; }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    unsigned char *b = (unsigned char *) malloc((size_t) n + 4);
    if (!b || fread(b, 1, (size_t) n, f) != (size_t) n) { fclose(f); return 7; }
    fclose(f);
    bool admit = false;
    cb_conn_init(NULL);
    cb_client_request(NULL, "00:00:00:00:00:00", "iPhone15,2", "iPhone Uji", &admit);
    cb_video_size(NULL, VIDEO_CODEC_H264, 960, 540, 0, 0, 960, 540);
    unsigned char *au = (unsigned char *) malloc((size_t) n * 2 + 64);
    int aul = 0, nal = 0; uint64_t t = 1000000000ULL; long i = 0;
    int64_t until = (int64_t) seconds * 30, sent = 0;
    while (running && sent < until) {
        /* cari NAL berikutnya */
        long s0 = -1, sc = 0;
        for (; i + 3 < n; i++) { if (b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1) { s0 = i + 3; sc = 3; break; } if (b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 0 && b[i + 3] == 1) { s0 = i + 4; sc = 4; break; } }
        (void) sc;
        if (s0 < 0) { i = 0; continue; } /* ulang dari awal file */
        long e = s0;
        while (e + 3 < n && !(b[e] == 0 && b[e + 1] == 0 && (b[e + 2] == 1 || (b[e + 2] == 0 && b[e + 3] == 1)))) e++;
        if (e + 3 >= n) e = n;
        int type = b[s0] & 0x1f;
        au[aul++] = 0; au[aul++] = 0; au[aul++] = 0; au[aul++] = 1;
        memcpy(au + aul, b + s0, (size_t) (e - s0)); aul += (int) (e - s0); nal++;
        i = e;
        if (type == 1 || type == 5) {
            video_decode_struct v; memset(&v, 0, sizeof v);
            v.is_h265 = false; v.nal_count = nal; v.data = au; v.data_len = aul; v.ntp_time_local = t; v.ntp_time_remote = t;
            cb_video_process(NULL, NULL, &v);
            aul = 0; nal = 0; t += 33333333ULL; sent++;
            msleep(33);
        }
    }
    status("selftest-done", "");
    free(au); free(b);
    return 0;
}

static int parse_mac(const char *s, char out[6]) {
    unsigned int v[6];
    if (sscanf(s, "%x:%x:%x:%x:%x:%x", &v[0], &v[1], &v[2], &v[3], &v[4], &v[5]) != 6) return -1;
    for (int i = 0; i < 6; i++) out[i] = (char) v[i];
    return 0;
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        const char *a = argv[i], *v = i + 1 < argc ? argv[i + 1] : "";
        if (!strcmp(a, "--name")) { snprintf(g_name, sizeof g_name, "%s", v); i++; }
        else if (!strcmp(a, "--port")) { g_port = atoi(v); i++; }
        else if (!strcmp(a, "--token")) { snprintf(g_token, sizeof g_token, "%s", v); i++; }
        else if (!strcmp(a, "--mac")) { snprintf(g_mac, sizeof g_mac, "%s", v); i++; }
        else if (!strcmp(a, "--keyfile")) { snprintf(g_keyfile, sizeof g_keyfile, "%s", v); i++; }
        else if (!strcmp(a, "--fps")) { g_fps = atoi(v); i++; }
        else if (!strcmp(a, "--size")) { if (sscanf(v, "%dx%d", &g_w, &g_h) != 2) { g_w = 1920; g_h = 1080; } i++; }
        else if (!strcmp(a, "--debug")) g_debug = 1;
        else if (!strcmp(a, "--version")) { printf("klm-airplay 1.0 (pustaka AirPlay: UxPlay, GPL-3.0)\n"); return 0; }
    }
    for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], "--selftest")) {
#ifdef _WIN32
        WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
        signal(SIGINT, on_signal); signal(SIGTERM, on_signal);
#ifndef _WIN32
        signal(SIGPIPE, SIG_IGN);
#endif
        snprintf(client_name, sizeof client_name, "iPhone Uji");
        return selftest(argv[i + 1], i + 2 < argc ? atoi(argv[i + 2]) : 20);
    }
#ifdef _WIN32
    { WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa); }
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX); /* jangan munculkan dialog error Windows */
#endif
    char hw[6];
    if (parse_mac(g_mac, hw) != 0) { fprintf(stderr, "klm-airplay: --mac AA:BB:CC:DD:EE:FF wajib diisi\n"); return 2; }
    signal(SIGINT, on_signal); signal(SIGTERM, on_signal);
#ifndef _WIN32
    signal(SIGPIPE, SIG_IGN);
#endif

    int err = 0;
    dnssd = dnssd_init(g_name, (int) strlen(g_name), hw, 6, 0, &err);
    if (err || !dnssd) { status("error", "layanan penemuan (mDNS) gagal dimulai"); return 3; }
    /* kemampuan yang diumumkan: mirroring layar + audio, tanpa HLS / H.265 (sama dengan bawaan UxPlay) */
    static const int feat[32] = { 0,1,1,0, 0,1,1,1, 0,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,0, 0,1,0,1, 1,0,1,0 };
    for (int b = 0; b < 32; b++) dnssd_set_airplay_features(dnssd, b, feat[b]);

    raop_callbacks_t cbs;
    memset(&cbs, 0, sizeof cbs);
    cbs.audio_process = cb_audio_process; cbs.video_process = cb_video_process;
    cbs.video_pause = cb_noop; cbs.video_resume = cb_noop; cbs.conn_feedback = cb_conn_feedback; cbs.conn_reset = cb_conn_reset;
    cbs.video_reset = cb_video_reset; cbs.video_set_codec_and_size = cb_video_size;
    cbs.conn_init = cb_conn_init; cbs.conn_destroy = cb_conn_destroy; cbs.audio_flush = cb_noop; cbs.video_flush = cb_noop;
    cbs.audio_set_client_volume = cb_client_volume; cbs.audio_set_volume = cb_set_volume;
    cbs.audio_set_metadata = cb_buf; cbs.audio_set_coverart = cb_buf; cbs.audio_stop_coverart_rendering = cb_noop;
    cbs.audio_remote_control_id = cb_remote_id; cbs.audio_set_progress = cb_progress; cbs.audio_get_format = cb_audio_format;
    cbs.mirror_video_running = cb_mirror_running; cbs.report_client_request = cb_client_request; cbs.display_pin = cb_display_pin;
    cbs.register_client = cb_register_client; cbs.check_register = cb_check_register; cbs.passwd = cb_passwd; cbs.export_dacp = cb_export_dacp;
    cbs.on_video_play = cb_play; cbs.on_video_scrub = cb_float; cbs.on_video_rate = cb_float; cbs.on_video_stop = cb_noop;
    cbs.on_video_acquire_playback_info = cb_playback_info; cbs.on_video_playlist_remove = cb_playlist_remove; cbs.get_custom_profile = cb_custom_profile;

    raop = raop_init(&cbs);
    if (!raop) { status("error", "pustaka AirPlay gagal dimulai"); return 4; }
    raop_set_log_callback(raop, cb_log, NULL);
    raop_set_log_level(raop, g_debug ? LOGGER_DEBUG : LOGGER_INFO);
    if (raop_init2(raop, 1, g_mac, g_keyfile)) { status("error", "kunci perangkat gagal dibuat"); return 5; }
    raop_set_plist(raop, "width", g_w); raop_set_plist(raop, "height", g_h);
    raop_set_plist(raop, "refreshRate", 60); raop_set_plist(raop, "maxFPS", g_fps > 30 ? 60 : 30); raop_set_plist(raop, "overscanned", 0);
    unsigned short tcp[3] = { 0, 0, 0 }, udp[3] = { 0, 0, 0 };
    raop_set_tcp_ports(raop, tcp); raop_set_udp_ports(raop, udp);
    unsigned short port = raop_get_port(raop);
    raop_start_httpd(raop, &port);
    raop_set_port(raop, port);
    raop_set_dnssd(raop, dnssd);
    if (dnssd_register_raop(dnssd, port) || dnssd_register_airplay(dnssd, port)) { status("error", "tidak bisa mengumumkan layanan AirPlay di jaringan"); return 6; }
    { char m[64]; snprintf(m, sizeof m, "%d", (int) port); status("ready", m); }

    int tick = 0;
    while (running) {
        msleep(100);
        if (++tick >= 10) { /* tiap detik: perangkat masih memberi kabar? */
            tick = 0;
            if (open_conns > 0) { if (++missed > 15) { status("lost", "perangkat tidak memberi kabar"); reset_req = 1; } } else missed = 0;
        }
        if (reset_req) {
            reset_req = 0; missed = 0;
            raop_stop_httpd(raop);
            raop_remove_known_connections(raop);
            pthread_mutex_lock(&out_mx); out_close_locked(); pthread_mutex_unlock(&out_mx);
            unsigned short p2 = raop_get_port(raop);
            raop_start_httpd(raop, &p2);
            raop_set_port(raop, p2);
        }
    }
    dnssd_unregister_raop(dnssd); dnssd_unregister_airplay(dnssd);
    raop_destroy(raop);
    dnssd_destroy(dnssd);
    return 0;
}
