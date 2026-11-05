/* KLM Mix HP - helper bersama (dipakai di browser HP maupun APK) */
'use strict';
window.KMP = (function () {
  const DEFAULT_PORT = 8620;
  const isApp = !!(window.Capacitor) || location.hostname === 'localhost' || location.protocol === 'file:' || location.protocol === 'capacitor:';
  const servedByPc = !isApp && /^https?:$/.test(location.protocol) && !!location.hostname;

  const P = {
    isApp, servedByPc,
    get(k, d) { try { const v = localStorage.getItem('klmhp.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('klmhp.' + k, JSON.stringify(v)); } catch (e) {} },
    server() {
      if (servedByPc) return { host: location.host, secure: location.protocol === 'https:' };
      let s = String(P.get('server', '') || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (s && !/:\d+$/.test(s)) s += ':' + DEFAULT_PORT;
      return { host: s, secure: false };
    },
    wsUrl() { const s = P.server(); return s.host ? (s.secure ? 'wss://' : 'ws://') + s.host + '/ws' : ''; },
    page(name) { // name: hp | cam | remote
      if (servedByPc) return '/' + name;
      return { hp: 'index.html', cam: 'camera.html', remote: 'remote.html', call: 'call.html', utc: 'utc.html' }[name];
    },
    deviceName() {
      const ua = navigator.userAgent;
      const m = /Android [\d.]+; ([^;)]+)/.exec(ua);
      return (m ? m[1].replace(/ Build.*/, '') : (/iPhone/.test(ua) ? 'iPhone' : 'HP')).trim();
    },
    toast(msg, ms) {
      let t = document.getElementById('kmp-toast');
      if (!t) { t = document.createElement('div'); t.id = 'kmp-toast'; document.body.appendChild(t); }
      t.textContent = msg; t.classList.add('show');
      clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2200);
    },
    /** koneksi WebSocket dengan auto-reconnect */
    connect(role, info, handlers) {
      const st = { ws: null, open: false, closed: false };
      const go = () => {
        const url = P.wsUrl();
        if (!url) { handlers.status && handlers.status('noserver'); return; }
        handlers.status && handlers.status('connecting');
        let ws;
        try { ws = new WebSocket(url); } catch (e) { setTimeout(go, 2000); return; }
        st.ws = ws;
        ws.onopen = () => { st.open = true; ws.send(JSON.stringify(Object.assign({ t: 'hello', role }, info()))); handlers.status && handlers.status('open'); };
        ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } handlers.message && handlers.message(m); };
        ws.onclose = () => { st.open = false; handlers.status && handlers.status('closed'); if (!st.closed) setTimeout(go, 2000); };
        ws.onerror = () => {};
      };
      st.send = (o) => { if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(o)); };
      st.reconnect = () => { try { st.ws && st.ws.close(); } catch (e) {} };
      go();
      return st;
    },
    async wakeLock() {
      try { if ('wakeLock' in navigator) { P._wl = await navigator.wakeLock.request('screen'); } } catch (e) {}
      document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') { try { P._wl = await navigator.wakeLock.request('screen'); } catch (e) {} } });
    }
  };
  return P;
})();
