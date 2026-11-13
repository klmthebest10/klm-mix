/* KLM Mix — NetLink: sinyal WebRTC lewat internet untuk KLMCAM di jaringan berbeda (WiFi lain / data seluler).
 * Hanya pesan sinyal (penawaran sambungan, kontrol, tally) yang lewat sini; gambar & suara tetap langsung HP ↔ PC (WebRTC).
 * Transport: MQTT 3.1.1 di atas WebSocket ke beberapa broker publik sekaligus (pesan ganda dibuang), isi pesan
 * dienkripsi AES-GCM dengan kunci dari kode ruang, sehingga broker tidak bisa membaca isinya. */
'use strict';
(function (root) {
  const BROKERS = root.KLM_NET_BROKERS || ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
  const te = new TextEncoder(), td = new TextDecoder();
  const str = (s) => { const b = te.encode(s), o = new Uint8Array(2 + b.length); o[0] = b.length >> 8; o[1] = b.length & 255; o.set(b, 2); return o; };
  const cat = (...a) => { let n = 0; a.forEach((x) => { n += x.length; }); const o = new Uint8Array(n); let p = 0; a.forEach((x) => { o.set(x, p); p += x.length; }); return o; };
  function packet(type, body) { const len = []; let n = body.length; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; len.push(d); } while (n > 0); return cat(new Uint8Array([type]), new Uint8Array(len), body); }
  const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');

  /** satu sambungan MQTT minimal (QoS 0) dengan sambung-ulang otomatis */
  function mqtt(url, topics, onMsg, onState) {
    const C = { ws: null, open: false, dead: false, buf: new Uint8Array(0), ping: 0, retry: 1500 };
    function connect() {
      if (C.dead) return;
      let ws;
      try { ws = new WebSocket(url, ['mqtt']); } catch (e) { return setTimeout(connect, 5000); }
      ws.binaryType = 'arraybuffer'; C.ws = ws; C.buf = new Uint8Array(0);
      ws.onopen = () => ws.send(packet(0x10, cat(str('MQTT'), new Uint8Array([4, 2, 0, 30]), str('klm' + Math.random().toString(36).slice(2, 12)))));
      ws.onmessage = (e) => { if (typeof e.data === 'string') return; C.buf = cat(C.buf, new Uint8Array(e.data)); parse(); };
      ws.onclose = () => { const was = C.open; C.open = false; clearInterval(C.ping); if (was) onState(); if (!C.dead) { setTimeout(connect, C.retry); C.retry = Math.min(C.retry * 1.6, 20000); } };
      ws.onerror = () => {};
    }
    function parse() {
      for (;;) {
        const b = C.buf; if (b.length < 2) return;
        let mult = 1, len = 0, i = 1, d;
        do { if (i >= b.length) return; d = b[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128 && i < 5);
        if (b.length < i + len) return;
        const type = b[0] >> 4, body = b.subarray(i, i + len);
        C.buf = b.slice(i + len);
        if (type === 2) { // CONNACK
          if (body[1] !== 0) { try { C.ws.close(); } catch (e) {} return; }
          C.open = true; C.retry = 1500;
          let id = 1; topics.forEach((t) => C.ws.send(packet(0x82, cat(new Uint8Array([0, id++]), str(t), new Uint8Array([0])))));
          clearInterval(C.ping); C.ping = setInterval(() => { try { C.ws.readyState === 1 && C.ws.send(new Uint8Array([0xC0, 0])); } catch (e) {} }, 20000);
          onState();
        } else if (type === 3) { // PUBLISH
          const tl = (body[0] << 8) | body[1], topic = td.decode(body.subarray(2, 2 + tl)), qos = (b[0] >> 1) & 3;
          onMsg(topic, body.slice(2 + tl + (qos ? 2 : 0)));
        }
      }
    }
    C.publish = (topic, payload) => { if (C.open && C.ws.readyState === 1) { try { C.ws.send(packet(0x30, cat(str(topic), payload))); return true; } catch (e) {} } return false; };
    C.close = () => { C.dead = true; clearInterval(C.ping); try { C.ws && C.ws.close(); } catch (e) {} };
    connect();
    return C;
  }

  /** gabung ke ruang. sub: daftar sub-topik yang didengar (mis. ['m'] untuk mixer, ['c/<id>'] untuk kamera)
   *  → { publish(sub, obj), close(), online() } ; h.message(obj, sub), h.status(jumlahBrokerTersambung) */
  async function join(room, subs, h, brokers) {
    room = String(room || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (room.length < 6) throw new Error('Kode internet minimal 6 karakter');
    if (!root.crypto || !crypto.subtle) throw new Error('Perangkat ini tidak mendukung enkripsi (butuh HTTPS / aplikasi)');
    const base = 'klmmix/v1/' + hex(await crypto.subtle.digest('SHA-256', te.encode('topik|' + room))).slice(0, 28) + '/';
    const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', te.encode('kunci|' + room + '|klm-mix')), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const seen = new Set(), order = [];
    const onMsg = async (topic, payload) => {
      if (!topic.startsWith(base) || payload.length < 29) return;
      try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: payload.subarray(0, 12) }, key, payload.subarray(12));
        const o = JSON.parse(td.decode(plain));
        if (!o || !o._i || seen.has(o._i)) return; // pesan yang sama datang dari broker lain
        seen.add(o._i); order.push(o._i); if (order.length > 600) seen.delete(order.shift());
        if (Math.abs(Date.now() - (o._t || 0)) > 120000) return; // pesan basi
        delete o._i; delete o._t;
        h.message && h.message(o, topic.slice(base.length));
      } catch (e) { /* bukan untuk ruang ini / rusak */ }
    };
    const conns = (brokers || BROKERS).map((u) => mqtt(u, subs.map((s) => base + s), onMsg, () => h.status && h.status(conns.filter((c) => c.open).length)));
    return {
      async publish(sub, obj) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = te.encode(JSON.stringify(Object.assign({}, obj, { _i: Math.random().toString(36).slice(2) + Date.now().toString(36), _t: Date.now() })));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
        const pay = cat(iv, ct); let n = 0;
        conns.forEach((c) => { if (c.publish(base + sub, pay)) n++; });
        return n;
      },
      online: () => conns.filter((c) => c.open).length,
      close() { conns.forEach((c) => c.close()); }
    };
  }
  const newRoom = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint8Array(10)); return Array.from(r).map((b) => A[b % A.length]).join(''); };
  /** server ICE: STUN publik + TURN milik sendiri (opsional) */
  const ice = (turn) => { const l = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]; if (turn && turn.url) l.push({ urls: String(turn.url).split(/[\s,]+/).filter(Boolean), username: turn.user || '', credential: turn.pass || '' }); return l; };
  root.KLMNet = { join, newRoom, ice, BROKERS };
})(typeof window !== 'undefined' ? window : globalThis);
