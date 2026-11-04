/* KLM Mix - Title "UTC KLM Acara" terintegrasi: lower third, judul, running text, jam, countdown,
   pengantin, khitanan, ayat, pengajian, breaking, credits, logo. Semua digambar di kanvas (offline). */
'use strict';
(function (KM) {
  const THEMES = {
    emas: { name: 'Emas Elegan', bg: '#17120a', primary: '#b8901f', p2: '#e6c35c', accent: '#f5d77a', text: '#ffffff', text2: '#f8ecc4', dark: '#17120a' },
    hijau: { name: 'Hijau Islami', bg: '#062b1c', primary: '#0f7a4a', p2: '#16a067', accent: '#d4af37', text: '#ffffff', text2: '#d9f5e6', dark: '#062b1c' },
    biru: { name: 'Biru Profesional', bg: '#0a1a40', primary: '#1d4ed8', p2: '#3b82f6', accent: '#38bdf8', text: '#ffffff', text2: '#dbeafe', dark: '#0a1a40' },
    merah: { name: 'Merah Breaking', bg: '#1c0707', primary: '#c81e1e', p2: '#ef4444', accent: '#fbbf24', text: '#ffffff', text2: '#fee2e2', dark: '#1c0707' },
    putih: { name: 'Putih Minimal', bg: '#ffffff', primary: '#ffffff', p2: '#f1f5f9', accent: '#2563eb', text: '#0f172a', text2: '#334155', dark: '#ffffff' },
    pink: { name: 'Pink Pengantin', bg: '#3d0a24', primary: '#be185d', p2: '#ec4899', accent: '#fbcfe8', text: '#ffffff', text2: '#fde7f3', dark: '#3d0a24' },
    ungu: { name: 'Ungu Royal', bg: '#1e0b3d', primary: '#6d28d9', p2: '#8b5cf6', accent: '#e9d5ff', text: '#ffffff', text2: '#ede9fe', dark: '#1e0b3d' },
    hitam: { name: 'Hitam Modern', bg: '#0a0a0a', primary: '#18181b', p2: '#27272a', accent: '#22d3ee', text: '#ffffff', text2: '#d4d4d8', dark: '#0a0a0a' }
  };
  const SANS = '"Segoe UI", "Bahnschrift", Arial, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", serif';
  const SCRIPT = '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive';
  const ARAB = '"Traditional Arabic", "Arabic Typesetting", "Amiri", "Segoe UI", serif';
  const HARI = ['Ahad', 'Senin', 'Selasa', 'Rabu', 'Kamis', "Jum'at", 'Sabtu'];
  const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  // ---------- helper gambar ----------
  function font(ctx, size, weight, fam) { ctx.font = (weight || '') + ' ' + Math.round(size) + 'px ' + (fam || SANS); }
  function fit(ctx, text, maxW, size, weight, fam) {
    let s = size; font(ctx, s, weight, fam);
    while (s > 10 && ctx.measureText(text).width > maxW) { s -= 2; font(ctx, s, weight, fam); }
    return s;
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
  function grad(ctx, x, y, w, c1, c2) { const g = ctx.createLinearGradient(x, y, x + w, y); g.addColorStop(0, c1); g.addColorStop(1, c2); return g; }
  function wrap(ctx, text, maxW) {
    const out = [];
    String(text).split('\n').forEach((para) => {
      let line = '';
      para.split(' ').forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  function shadow(ctx, on, blur) { ctx.shadowColor = on ? 'rgba(0,0,0,.55)' : 'transparent'; ctx.shadowBlur = on ? (blur || 12) : 0; ctx.shadowOffsetY = on ? 3 : 0; }
  function tanggal(d) { return HARI[d.getDay()] + ', ' + d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear(); }
  function hijri(d) {
    try { return new Intl.DateTimeFormat('id-ID-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' }).format(d).replace(/\s*(SH|H|AH)\.?$/, '') + ' H'; }
    catch (e) { return ''; }
  }
  function star(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, rad = i % 2 ? r * 0.45 : r; ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
    ctx.closePath(); ctx.fill();
  }
  function heart(ctx, x, y, s) {
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.3);
    ctx.bezierCurveTo(x, y, x - s / 2, y, x - s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x - s / 2, y + s * 0.6, x, y + s * 0.8, x, y + s);
    ctx.bezierCurveTo(x, y + s * 0.8, x + s / 2, y + s * 0.6, x + s / 2, y + s * 0.3);
    ctx.bezierCurveTo(x + s / 2, y, x, y, x, y + s * 0.3); ctx.fill();
  }
  function crescent(ctx, x, y, r, col, bg) {
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x + r * 0.38, y - r * 0.12, r * 0.82, 0, Math.PI * 2); ctx.fill();
  }
  function ornamentLine(ctx, cx, y, w, col, k) {
    ctx.strokeStyle = col; ctx.lineWidth = 2 * k;
    ctx.beginPath(); ctx.moveTo(cx - w / 2, y); ctx.lineTo(cx - 18 * k, y); ctx.moveTo(cx + 18 * k, y); ctx.lineTo(cx + w / 2, y); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, y - 9 * k); ctx.lineTo(cx + 9 * k, y); ctx.lineTo(cx, y + 9 * k); ctx.lineTo(cx - 9 * k, y); ctx.closePath(); ctx.fill();
  }

  // ---------- template ----------
  const TPL = {};

  TPL['lt-klasik'] = {
    name: 'Lower Third Klasik', group: 'Lower Third',
    fields: [{ k: 'nama', label: 'Nama', def: 'Ustadz Ahmad Fauzi, Lc.' }, { k: 'ket', label: 'Keterangan', def: 'Pengisi Kajian' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const x = 110 * k, y = H - 300 * k;
      const s1 = fit(ctx, f.nama, 1100 * k, 54 * k, '700');
      const w1 = ctx.measureText(f.nama).width + 110 * k;
      font(ctx, 32 * k, '500'); const w2 = ctx.measureText(f.ket).width + 90 * k;
      const e = KM.easeOut(a);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y - 10 * k, Math.max(w1, w2) * e + 20 * k, 200 * k); ctx.clip();
      shadow(ctx, true, 18 * k);
      ctx.fillStyle = grad(ctx, x, y, w1, th.primary, th.p2); ctx.fillRect(x, y, w1, 92 * k);
      shadow(ctx, false);
      ctx.fillStyle = th.accent; ctx.fillRect(x, y, 14 * k, 92 * k);
      ctx.fillStyle = th.dark; ctx.globalAlpha = 0.92; ctx.fillRect(x + 14 * k, y + 92 * k, w2, 58 * k); ctx.globalAlpha = 1;
      ctx.globalAlpha = KM.clamp((a - 0.3) / 0.5, 0, 1);
      ctx.fillStyle = th.primary === '#ffffff' ? th.text : '#fff'; font(ctx, s1, '700'); ctx.textBaseline = 'middle';
      ctx.fillText(f.nama, x + 50 * k, y + 47 * k);
      ctx.fillStyle = th.text2; font(ctx, 32 * k, '500'); ctx.fillText(f.ket, x + 50 * k, y + 122 * k);
      ctx.restore();
    }
  };

  TPL['lt-modern'] = {
    name: 'Lower Third Modern', group: 'Lower Third',
    fields: [{ k: 'tag', label: 'Label kecil', def: 'NARASUMBER' }, { k: 'nama', label: 'Nama', def: 'Dr. H. Muhammad Ridwan' }, { k: 'ket', label: 'Keterangan', def: 'Ketua Panitia Acara' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), off = (1 - e) * -700 * k;
      const x = 120 * k + off, y = H - 330 * k;
      ctx.globalAlpha = Math.min(1, a * 2);
      font(ctx, 24 * k, '800'); const wt = ctx.measureText(f.tag).width + 40 * k;
      ctx.fillStyle = th.accent; ctx.fillRect(x, y, wt, 40 * k);
      ctx.fillStyle = th.dark; ctx.textBaseline = 'middle'; ctx.fillText(f.tag, x + 20 * k, y + 21 * k);
      const s = fit(ctx, f.nama, 1000 * k, 50 * k, '800'); const wn = ctx.measureText(f.nama).width + 70 * k;
      shadow(ctx, true, 14 * k); ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y + 40 * k, wn, 84 * k); shadow(ctx, false);
      ctx.fillStyle = '#0f172a'; font(ctx, s, '800'); ctx.fillText(f.nama, x + 35 * k, y + 84 * k);
      font(ctx, 30 * k, '500'); const wk = ctx.measureText(f.ket).width + 70 * k;
      ctx.fillStyle = grad(ctx, x, 0, wk, th.primary === '#ffffff' ? th.accent : th.primary, th.p2); ctx.fillRect(x, y + 124 * k, wk, 52 * k);
      ctx.fillStyle = '#fff'; ctx.fillText(f.ket, x + 35 * k, y + 151 * k);
      ctx.globalAlpha = 1;
    }
  };

  TPL['lt-elegan'] = {
    name: 'Lower Third Elegan (Tengah)', group: 'Lower Third',
    fields: [{ k: 'nama', label: 'Nama', def: 'Bapak H. Sulaiman & Ibu Hj. Aminah' }, { k: 'ket', label: 'Keterangan', def: 'Orang Tua Mempelai Wanita' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), cx = W / 2, y = H - 250 * k;
      ctx.globalAlpha = e;
      const g = ctx.createLinearGradient(0, y - 70 * k, 0, y + 110 * k);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, th.dark + 'dd'); g.addColorStop(1, th.dark + 'ee');
      ctx.fillStyle = g; ctx.fillRect(cx - 800 * k * e, y - 70 * k, 1600 * k * e, 180 * k);
      ornamentLine(ctx, cx, y - 28 * k, 900 * k * e, th.accent, k);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = th.text;
      fit(ctx, f.nama, 1400 * k, 58 * k, 'italic 600', SERIF); shadow(ctx, true, 8 * k); ctx.fillText(f.nama, cx, y + 28 * k);
      shadow(ctx, false); ctx.fillStyle = th.accent; font(ctx, 30 * k, '500', SERIF); ctx.fillText(f.ket, cx, y + 82 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['judul'] = {
    name: 'Judul Tengah', group: 'Judul',
    fields: [{ k: 'judul', label: 'Judul', def: 'PENGAJIAN AKBAR' }, { k: 'sub', label: 'Sub judul', def: 'Memperingati Maulid Nabi Muhammad SAW' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), cx = W / 2, cy = H / 2;
      ctx.globalAlpha = e; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,' + 0.45 * e + ')'; ctx.fillRect(0, cy - 150 * k, W, 300 * k);
      ctx.fillStyle = th.accent; ctx.fillRect(cx - 500 * k * e, cy + 18 * k, 1000 * k * e, 5 * k);
      const s = fit(ctx, f.judul, 1700 * k, 110 * k, '900'); shadow(ctx, true, 20 * k);
      ctx.fillStyle = th.primary === '#ffffff' ? '#fff' : th.text; ctx.save(); ctx.translate(cx, cy - 50 * k); ctx.scale(0.9 + 0.1 * e, 0.9 + 0.1 * e);
      font(ctx, s, '900'); ctx.fillText(f.judul, 0, 0); ctx.restore();
      shadow(ctx, false); ctx.fillStyle = th.text2; fit(ctx, f.sub, 1600 * k, 46 * k, '500'); ctx.fillText(f.sub, cx, cy + 80 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['running'] = {
    name: 'Running Text', group: 'Info',
    fields: [{ k: 'label', label: 'Label', def: 'INFO' }, { k: 'teks', label: 'Teks berjalan', def: 'Selamat datang di acara kami • Mohon matikan nada dering ponsel Anda • Terima kasih atas kehadirannya', multi: true }, { k: 'speed', label: 'Kecepatan (px/detik)', def: '160' }],
    draw(ctx, W, H, f, th, a, t, k, inp) {
      const e = KM.easeOut(a), hgt = 74 * k, y = H - 60 * k - hgt + (1 - e) * (hgt + 80 * k);
      ctx.fillStyle = th.dark; ctx.globalAlpha = 0.92; ctx.fillRect(0, y, W, hgt); ctx.globalAlpha = 1;
      ctx.fillStyle = th.accent; ctx.fillRect(0, y, W, 4 * k);
      font(ctx, 34 * k, '800'); const lw = ctx.measureText(f.label).width + 60 * k;
      const txt = String(f.teks).replace(/\n/g, '   •   ');
      font(ctx, 36 * k, '600');
      const tw = ctx.measureText(txt).width + 160 * k;
      const sp = (parseFloat(f.speed) || 160) * k;
      const rt = inp.rt; rt.tick0 = rt.tick0 || t;
      const off = ((t - rt.tick0) / 1000 * sp) % tw;
      ctx.save(); ctx.beginPath(); ctx.rect(lw, y, W - lw, hgt); ctx.clip();
      ctx.fillStyle = th.text; ctx.textBaseline = 'middle';
      for (let x = lw + 40 * k - off; x < W; x += tw) ctx.fillText(txt, x, y + hgt / 2 + 2 * k);
      ctx.restore();
      ctx.fillStyle = grad(ctx, 0, 0, lw, th.primary === '#ffffff' ? th.accent : th.primary, th.p2); ctx.fillRect(0, y, lw, hgt);
      ctx.fillStyle = '#fff'; font(ctx, 34 * k, '800'); ctx.fillText(f.label, 30 * k, y + hgt / 2 + 2 * k);
    }
  };

  TPL['logo'] = {
    name: 'Logo / Bug Pojok', group: 'Info',
    fields: [{ k: 'teks', label: 'Teks (jika tanpa logo)', def: 'KLM TV' }, { k: 'live', label: 'Tampilkan LIVE (ya/tidak)', def: 'ya' }, { k: 'posisi', label: 'Posisi (kanan/kiri)', def: 'kanan' }],
    draw(ctx, W, H, f, th, a, t, k, inp) {
      ctx.globalAlpha = KM.easeOut(a);
      const right = String(f.posisi).toLowerCase() !== 'kiri';
      const img = inp.rt.logoImg;
      let bw, bh = 110 * k;
      if (img && img.complete && img.naturalWidth) bw = bh * img.naturalWidth / img.naturalHeight; else { font(ctx, 52 * k, '900'); bw = ctx.measureText(f.teks).width + 20 * k; }
      const x = right ? W - 70 * k - bw : 70 * k, y = 55 * k;
      shadow(ctx, true, 10 * k);
      if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x, y, bw, bh);
      else { ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; font(ctx, 52 * k, '900'); ctx.fillText(f.teks, x + 10 * k, y + bh / 2); }
      shadow(ctx, false);
      if (String(f.live).toLowerCase().startsWith('y')) {
        const lx = right ? x + bw - 120 * k : x, ly = y + bh + 12 * k;
        ctx.fillStyle = '#dc2626'; rr(ctx, lx, ly, 120 * k, 40 * k, 6 * k); ctx.fill();
        ctx.fillStyle = (Math.floor(t / 600) % 2) ? '#fff' : '#fca5a5'; ctx.beginPath(); ctx.arc(lx + 22 * k, ly + 20 * k, 8 * k, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; font(ctx, 26 * k, '800'); ctx.textBaseline = 'middle'; ctx.fillText('LIVE', lx + 40 * k, ly + 21 * k);
      }
      ctx.globalAlpha = 1;
    }
  };

  TPL['jam'] = {
    name: 'Jam & Tanggal (+Hijriah)', group: 'Info',
    fields: [{ k: 'kota', label: 'Lokasi', def: 'Masjid Sayyidina Bilal' }, { k: 'hijri', label: 'Tampilkan Hijriah (ya/tidak)', def: 'ya' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const d = new Date(), e = KM.easeOut(a);
      const x = 60 * k - (1 - e) * 500 * k, y = 50 * k, w = 430 * k, showH = String(f.hijri).toLowerCase().startsWith('y');
      const hgt = (showH ? 190 : 155) * k;
      shadow(ctx, true, 14 * k); ctx.fillStyle = th.dark; ctx.globalAlpha = 0.9; rr(ctx, x, y, w, hgt, 14 * k); ctx.fill(); ctx.globalAlpha = 1; shadow(ctx, false);
      ctx.fillStyle = th.accent; ctx.fillRect(x, y + 18 * k, 8 * k, hgt - 36 * k);
      ctx.fillStyle = th.text; ctx.textBaseline = 'alphabetic';
      font(ctx, 66 * k, '700', 'Consolas, "Segoe UI", monospace');
      ctx.fillText(KM.pad(d.getHours()) + ':' + KM.pad(d.getMinutes()) + ':' + KM.pad(d.getSeconds()), x + 32 * k, y + 76 * k);
      ctx.fillStyle = th.text2; fit(ctx, tanggal(d), w - 50 * k, 28 * k, '600'); ctx.fillText(tanggal(d), x + 32 * k, y + 116 * k);
      if (showH) { ctx.fillStyle = th.accent; font(ctx, 25 * k, '500'); ctx.fillText(hijri(d), x + 32 * k, y + 150 * k); }
      ctx.fillStyle = th.text2; ctx.globalAlpha = 0.85; fit(ctx, f.kota, w - 50 * k, 22 * k, '400'); ctx.fillText(f.kota, x + 32 * k, y + hgt - 16 * k); ctx.globalAlpha = 1;
    }
  };

  TPL['countdown'] = {
    name: 'Hitung Mundur', group: 'Info',
    fields: [{ k: 'judul', label: 'Judul', def: 'Acara akan segera dimulai' }, { k: 'menit', label: 'Durasi (menit)', def: '10' }, { k: 'selesai', label: 'Teks saat selesai', def: 'Selamat Menyaksikan' }],
    draw(ctx, W, H, f, th, a, t, k, inp) {
      const e = KM.easeOut(a), cx = W / 2, cy = H / 2;
      const total = (parseFloat(f.menit) || 0) * 60;
      const end = inp.opts.cdEnd;
      let left = end ? Math.max(0, (end - Date.now()) / 1000) : total;
      if (inp.opts.cdPausedLeft != null) left = inp.opts.cdPausedLeft;
      ctx.globalAlpha = e; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = th.dark; ctx.globalAlpha = 0.75 * e; rr(ctx, cx - 620 * k, cy - 230 * k, 1240 * k, 460 * k, 30 * k); ctx.fill(); ctx.globalAlpha = e;
      ctx.strokeStyle = th.accent; ctx.lineWidth = 4 * k; rr(ctx, cx - 600 * k, cy - 210 * k, 1200 * k, 420 * k, 24 * k); ctx.stroke();
      ctx.fillStyle = th.text2; fit(ctx, f.judul, 1100 * k, 54 * k, '600'); ctx.fillText(f.judul, cx, cy - 130 * k);
      ctx.fillStyle = th.text;
      if (end && left <= 0) { fit(ctx, f.selesai, 1100 * k, 110 * k, '800'); ctx.fillText(f.selesai, cx, cy + 40 * k); }
      else {
        const m = Math.floor(left / 60), s = Math.floor(left % 60), hh = Math.floor(m / 60);
        const txt = (hh ? hh + ':' + KM.pad(m % 60) : KM.pad(m)) + ':' + KM.pad(s);
        shadow(ctx, true, 18 * k); font(ctx, 200 * k, '800', 'Consolas, "Segoe UI", monospace'); ctx.fillText(txt, cx, cy + 50 * k); shadow(ctx, false);
      }
      const prog = total ? KM.clamp(1 - left / total, 0, 1) : 0;
      ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.fillRect(cx - 500 * k, cy + 165 * k, 1000 * k, 10 * k);
      ctx.fillStyle = th.accent; ctx.fillRect(cx - 500 * k, cy + 165 * k, 1000 * k * prog, 10 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['pengantin'] = {
    name: 'Pernikahan (Nama Mempelai)', group: 'Acara',
    fields: [{ k: 'atas', label: 'Teks atas', def: 'The Wedding of' }, { k: 'pria', label: 'Mempelai pria', def: 'Dimas' }, { k: 'wanita', label: 'Mempelai wanita', def: 'Rina' }, { k: 'tgl', label: 'Tanggal / tempat', def: 'Ahad, 15 November 2026 • Gedung Serbaguna' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), cx = W / 2, y = H - 300 * k;
      ctx.globalAlpha = e;
      const g = ctx.createLinearGradient(0, y - 40 * k, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.4, th.dark + 'cc'); g.addColorStop(1, th.dark + 'f2');
      ctx.fillStyle = g; ctx.fillRect(0, y - 40 * k, W, H - y + 40 * k);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = th.accent; font(ctx, 38 * k, 'italic', SERIF); ctx.fillText(f.atas, cx, y + 20 * k);
      const names = f.pria + '  &  ' + f.wanita;
      ctx.fillStyle = th.text; shadow(ctx, true, 12 * k); ctx.save(); ctx.translate(cx, y + 110 * k); const sc = 0.85 + 0.15 * e; ctx.scale(sc, sc);
      fit(ctx, names, 1500 * k, 104 * k, '400', SCRIPT); ctx.fillText(names, 0, 0); ctx.restore(); shadow(ctx, false);
      ornamentLine(ctx, cx, y + 185 * k, 760 * k * e, th.accent, k);
      ctx.fillStyle = th.accent; for (let i = -1; i <= 1; i += 2) heart(ctx, cx + i * 420 * k * e, y + 175 * k, 22 * k);
      ctx.fillStyle = th.text2; fit(ctx, f.tgl, 1400 * k, 32 * k, '500', SERIF); ctx.fillText(f.tgl, cx, y + 235 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['khitanan'] = {
    name: 'Khitanan / Tasyakuran', group: 'Acara',
    fields: [{ k: 'judul', label: 'Judul', def: 'Tasyakuran Khitanan' }, { k: 'nama', label: 'Nama anak', def: 'Muhammad Fatih Al-Fikri' }, { k: 'ortu', label: 'Putra dari', def: 'Putra dari Bpk. Kholil & Ibu Siti' }, { k: 'tgl', label: 'Tanggal', def: 'Sabtu, 21 November 2026' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), cx = W / 2, y = H - 330 * k, w = 1300 * k;
      ctx.globalAlpha = e;
      shadow(ctx, true, 22 * k); ctx.fillStyle = th.dark; ctx.globalAlpha = 0.9 * e; rr(ctx, cx - w / 2, y, w, 280 * k, 24 * k); ctx.fill(); shadow(ctx, false); ctx.globalAlpha = e;
      ctx.strokeStyle = th.accent; ctx.lineWidth = 3 * k; rr(ctx, cx - w / 2 + 12 * k, y + 12 * k, w - 24 * k, 256 * k, 18 * k); ctx.stroke();
      crescent(ctx, cx - w / 2 + 90 * k, y + 140 * k, 46 * k, th.accent, th.dark);
      ctx.fillStyle = th.accent; star(ctx, cx + w / 2 - 90 * k, y + 140 * k, 40 * k);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = th.accent; font(ctx, 36 * k, '600', SERIF); ctx.fillText(f.judul, cx, y + 52 * k);
      ctx.fillStyle = th.text; fit(ctx, f.nama, w - 280 * k, 72 * k, '800'); ctx.fillText(f.nama, cx, y + 128 * k);
      ctx.fillStyle = th.text2; fit(ctx, f.ortu, w - 280 * k, 32 * k, '500'); ctx.fillText(f.ortu, cx, y + 190 * k);
      ctx.fillStyle = th.accent; font(ctx, 26 * k, '500'); ctx.fillText(f.tgl, cx, y + 236 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['ayat'] = {
    name: 'Ayat / Hadits / Kutipan', group: 'Pengajian',
    fields: [{ k: 'arab', label: 'Teks Arab', def: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا', multi: true }, { k: 'arti', label: 'Terjemahan', def: '"Sesungguhnya bersama kesulitan ada kemudahan."', multi: true }, { k: 'sumber', label: 'Sumber', def: 'QS. Al-Insyirah: 6' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), cx = W / 2, w = 1500 * k;
      font(ctx, 32 * k, 'italic 500', SERIF); const lines = wrap(ctx, f.arti, w - 120 * k).slice(0, 3);
      font(ctx, 62 * k, '400', ARAB); const al = wrap(ctx, f.arab, w - 120 * k).slice(0, 2);
      const hgt = (60 + al.length * 78 + lines.length * 44 + 60) * k;
      const y = H - 70 * k - hgt + (1 - e) * 60 * k;
      ctx.globalAlpha = e;
      shadow(ctx, true, 20 * k); ctx.fillStyle = th.dark; ctx.globalAlpha = 0.88 * e; rr(ctx, cx - w / 2, y, w, hgt, 20 * k); ctx.fill(); shadow(ctx, false); ctx.globalAlpha = e;
      ctx.fillStyle = th.accent; ctx.fillRect(cx - w / 2, y + 24 * k, 8 * k, hgt - 48 * k);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = th.text; font(ctx, 62 * k, '400', ARAB); ctx.direction = 'rtl';
      al.forEach((l, i) => ctx.fillText(l, cx, y + (60 + i * 78) * k));
      ctx.direction = 'ltr';
      ctx.fillStyle = th.text2; font(ctx, 32 * k, 'italic 500', SERIF);
      const ly = y + (60 + al.length * 78 - 10) * k;
      lines.forEach((l, i) => ctx.fillText(l, cx, ly + i * 44 * k));
      ctx.fillStyle = th.accent; font(ctx, 26 * k, '700'); ctx.fillText(f.sumber, cx, ly + lines.length * 44 * k + 4 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['pengajian'] = {
    name: 'Info Kajian / Pengajian', group: 'Pengajian',
    fields: [{ k: 'tag', label: 'Label', def: 'KAJIAN RUTIN' }, { k: 'tema', label: 'Tema', def: 'Menggapai Keberkahan Hidup' }, { k: 'nama', label: 'Bersama', def: 'Ustadz Abdul Somad, Lc., MA.' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), x = 100 * k, y = H - 350 * k;
      const s = fit(ctx, f.tema, 1200 * k, 58 * k, '800'); const wt = Math.max(ctx.measureText(f.tema).width, 500 * k) + 220 * k;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y - 30 * k, wt * e + 10 * k, 300 * k); ctx.clip();
      shadow(ctx, true, 16 * k); ctx.fillStyle = grad(ctx, x, 0, wt, th.primary === '#ffffff' ? '#fff' : th.primary, th.p2); ctx.fillRect(x, y + 40 * k, wt, 100 * k); shadow(ctx, false);
      ctx.fillStyle = th.dark; ctx.globalAlpha = 0.92; ctx.fillRect(x, y + 140 * k, wt * 0.8, 60 * k); ctx.globalAlpha = 1;
      ctx.fillStyle = th.accent; ctx.fillRect(x, y, 300 * k, 40 * k);
      ctx.fillStyle = th.dark; font(ctx, 24 * k, '800'); ctx.textBaseline = 'middle'; ctx.fillText(f.tag, x + 18 * k, y + 21 * k);
      crescent(ctx, x + 70 * k, y + 90 * k, 32 * k, th.accent, th.primary === '#ffffff' ? '#fff' : th.primary);
      ctx.fillStyle = th.primary === '#ffffff' ? '#0f172a' : '#fff'; font(ctx, s, '800'); ctx.fillText(f.tema, x + 130 * k, y + 92 * k);
      ctx.fillStyle = th.text2; font(ctx, 30 * k, '500'); ctx.fillText('bersama ' + f.nama, x + 30 * k, y + 171 * k);
      ctx.restore();
    }
  };

  TPL['breaking'] = {
    name: 'Breaking / Pengumuman', group: 'Info',
    fields: [{ k: 'label', label: 'Label', def: 'PENGUMUMAN' }, { k: 'teks', label: 'Isi', def: 'Shalat Isya berjamaah akan dimulai 10 menit lagi' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), y = H - 230 * k, x = 80 * k, w = W - 160 * k;
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w * e, 140 * k); ctx.clip();
      ctx.fillStyle = '#fff'; shadow(ctx, true, 18 * k); ctx.fillRect(x, y + 50 * k, w, 90 * k); shadow(ctx, false);
      font(ctx, 30 * k, '900'); const lw = ctx.measureText(f.label).width + 50 * k;
      ctx.fillStyle = th.primary === '#ffffff' ? th.accent : th.primary; ctx.fillRect(x, y, lw, 50 * k);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(f.label, x + 25 * k, y + 27 * k);
      ctx.fillStyle = '#0f172a'; fit(ctx, f.teks, w - 60 * k, 46 * k, '700'); ctx.fillText(f.teks, x + 30 * k, y + 97 * k);
      ctx.fillStyle = th.accent; ctx.fillRect(x, y + 136 * k, w, 4 * k);
      ctx.restore();
    }
  };

  TPL['ucapan'] = {
    name: 'Ucapan / Sambutan', group: 'Acara',
    fields: [{ k: 'atas', label: 'Atas', def: 'Selamat Datang' }, { k: 'utama', label: 'Utama', def: 'Para Tamu Undangan' }, { k: 'bawah', label: 'Bawah', def: 'Semoga acara ini membawa keberkahan bagi kita semua' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), cx = W / 2, cy = H / 2;
      ctx.globalAlpha = e; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const g = ctx.createRadialGradient(cx, cy, 50 * k, cx, cy, 900 * k); g.addColorStop(0, th.dark + 'e6'); g.addColorStop(1, th.dark + '00');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = th.accent; font(ctx, 54 * k, 'italic', SERIF); ctx.fillText(f.atas, cx, cy - 120 * k);
      ctx.fillStyle = th.text; shadow(ctx, true, 16 * k); fit(ctx, f.utama, 1700 * k, 120 * k, '800'); ctx.fillText(f.utama, cx, cy); shadow(ctx, false);
      ornamentLine(ctx, cx, cy + 90 * k, 1000 * k * e, th.accent, k);
      ctx.fillStyle = th.text2; fit(ctx, f.bawah, 1600 * k, 36 * k, '500'); ctx.fillText(f.bawah, cx, cy + 150 * k);
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['credits'] = {
    name: 'Credit Roll / Terima Kasih', group: 'Acara',
    fields: [{ k: 'judul', label: 'Judul', def: 'Terima Kasih Kepada' }, { k: 'teks', label: 'Daftar (satu per baris)', def: 'Panitia Acara\nTakmir Masjid\nRemaja Masjid\nWarga Sekitar\nTim Multimedia KLM', multi: true }, { k: 'speed', label: 'Kecepatan', def: '60' }],
    draw(ctx, W, H, f, th, a, t, k, inp) {
      const e = KM.easeOut(a), cx = W / 2;
      ctx.globalAlpha = e;
      ctx.fillStyle = th.dark; ctx.globalAlpha = 0.7 * e; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = e;
      const lines = String(f.teks).split('\n');
      const lh = 64 * k, total = 220 * k + lines.length * lh + H;
      const rt = inp.rt; rt.tick0 = rt.tick0 || t;
      const off = ((t - rt.tick0) / 1000 * (parseFloat(f.speed) || 60) * k) % total;
      let y = H - off;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = th.accent; font(ctx, 70 * k, '800'); ctx.fillText(f.judul, cx, y); y += 160 * k;
      ctx.fillStyle = th.text; font(ctx, 44 * k, '500');
      lines.forEach((l) => { ctx.fillText(l, cx, y); y += lh; });
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    }
  };

  TPL['skor'] = {
    name: 'Skor Lomba Sederhana', group: 'Info',
    fields: [{ k: 'a', label: 'Tim/Peserta A', def: 'TPQ Al-Ikhlas' }, { k: 'sa', label: 'Skor A', def: '0' }, { k: 'b', label: 'Tim/Peserta B', def: 'TPQ Nurul Huda' }, { k: 'sb', label: 'Skor B', def: '0' }, { k: 'ket', label: 'Keterangan', def: 'Lomba Cerdas Cermat' }],
    draw(ctx, W, H, f, th, a, t, k) {
      const e = KM.easeOut(a), x = 60 * k, y = 50 * k - (1 - e) * 200 * k, w = 760 * k;
      ctx.globalAlpha = e; shadow(ctx, true, 14 * k);
      ctx.fillStyle = th.dark; ctx.globalAlpha = 0.92 * e; rr(ctx, x, y, w, 150 * k, 12 * k); ctx.fill(); ctx.globalAlpha = e; shadow(ctx, false);
      ctx.textBaseline = 'middle';
      const row = (name, sc, yy) => {
        ctx.fillStyle = th.text; fit(ctx, name, w - 200 * k, 34 * k, '700'); ctx.fillText(name, x + 24 * k, yy);
        ctx.fillStyle = th.primary === '#ffffff' ? th.accent : th.primary; ctx.fillRect(x + w - 130 * k, yy - 26 * k, 110 * k, 52 * k);
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; font(ctx, 40 * k, '800'); ctx.fillText(sc, x + w - 75 * k, yy + 2 * k); ctx.textAlign = 'left';
      };
      row(f.a, f.sa, y + 40 * k); row(f.b, f.sb, y + 104 * k);
      ctx.fillStyle = th.accent; ctx.fillRect(x, y + 150 * k, w, 38 * k);
      ctx.fillStyle = th.dark; font(ctx, 22 * k, '700'); ctx.fillText(f.ket, x + 20 * k, y + 170 * k);
      ctx.globalAlpha = 1;
    }
  };

  // ---------- Template bebas dari Title Designer ----------
  TPL['custom'] = {
    name: 'Desain Sendiri (Title Designer)', group: 'Desain',
    fields: [],
    fieldsFor(inp) {
      const els = ((inp.opts.design || {}).elements || []).filter((e) => e.type === 'text' && e.name);
      return els.map((e) => ({ k: e.name, label: e.name, def: e.text, multi: /\n/.test(e.text || '') }));
    },
    draw(ctx, W, H, f, th, a, t, k, inp) {
      const d = inp.opts.design || { elements: [] };
      const sx = W / 1920, sy = H / 1080;
      for (const el of d.elements) {
        if (el.hidden) continue;
        const delay = KM.clamp(el.delay || 0, 0, 0.9);
        const p = KM.easeOut(KM.clamp((a - delay) / (1 - delay), 0, 1));
        if (p <= 0) continue;
        const x = el.x * sx, y = el.y * sy, w = el.w * sx, hh = el.h * sy;
        ctx.save();
        ctx.globalAlpha = (el.opacity == null ? 1 : el.opacity) * (el.anim === 'none' ? (a > 0 ? 1 : 0) : (el.anim === 'fade' || !el.anim ? p : Math.min(1, p * 1.5)));
        const off = 1 - p;
        if (el.anim === 'slide-left') ctx.translate(-off * (x + w + 40), 0);
        else if (el.anim === 'slide-right') ctx.translate(off * (W - x + 40), 0);
        else if (el.anim === 'slide-up') ctx.translate(0, off * (H - y + 40));
        else if (el.anim === 'slide-down') ctx.translate(0, -off * (y + hh + 40));
        else if (el.anim === 'zoom') { ctx.translate(x + w / 2, y + hh / 2); ctx.scale(Math.max(0.01, p), Math.max(0.01, p)); ctx.translate(-(x + w / 2), -(y + hh / 2)); }
        else if (el.anim === 'wipe') { ctx.beginPath(); ctx.rect(x, y - 4, w * p, hh + 8); ctx.clip(); }
        if (el.rot) { ctx.translate(x + w / 2, y + hh / 2); ctx.rotate(el.rot * Math.PI / 180); ctx.translate(-(x + w / 2), -(y + hh / 2)); }
        if (el.shadow) shadow(ctx, true, 14 * k);
        if (el.type === 'rect' || el.type === 'ellipse' || (el.type === 'text' && el.bg)) {
          const fill = el.type === 'text' ? el.bg : el.fill;
          if (fill) {
            ctx.fillStyle = el.fill2 && el.type !== 'text' ? grad(ctx, x, y, w, fill, el.fill2) : fill;
            if (el.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2); ctx.fill(); }
            else { rr(ctx, x, y, w, hh, (el.radius || 0) * sx); ctx.fill(); }
          }
          if (el.stroke && el.strokeW) { ctx.strokeStyle = el.stroke; ctx.lineWidth = el.strokeW * sx; if (el.type === 'ellipse') { ctx.beginPath(); ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2); } else rr(ctx, x, y, w, hh, (el.radius || 0) * sx); ctx.stroke(); }
        }
        shadow(ctx, false);
        if (el.type === 'image' && el.src) {
          let img = (inp.rt.imgs = inp.rt.imgs || {})[el.id];
          if (!img || img._src !== el.src) { img = new Image(); img.src = el.src; img._src = el.src; inp.rt.imgs[el.id] = img; }
          if (img.complete && img.naturalWidth) ctx.drawImage(img, x, y, w, hh);
        }
        if (el.type === 'line') { ctx.strokeStyle = el.fill || '#fff'; ctx.lineWidth = Math.max(1, hh); ctx.beginPath(); ctx.moveTo(x, y + hh / 2); ctx.lineTo(x + w, y + hh / 2); ctx.stroke(); }
        if (el.type === 'text') {
          const txt = el.name && f[el.name] != null ? String(f[el.name]) : (el.text || '');
          const fam = { sans: SANS, serif: SERIF, script: SCRIPT, arab: ARAB, mono: 'Consolas, monospace' }[el.font] || SANS;
          const wt = (el.italic ? 'italic ' : '') + (el.weight || '700');
          const pad = (el.pad || 0) * sx;
          let size = (el.size || 48) * sy;
          font(ctx, size, wt, fam);
          const lines = String(txt).split('\n');
          if (el.fit !== false) { const mw = Math.max(...lines.map((l) => ctx.measureText(l).width)); if (mw > w - pad * 2 && mw > 0) { size *= (w - pad * 2) / mw; font(ctx, size, wt, fam); } }
          ctx.fillStyle = el.color || '#fff'; ctx.textBaseline = 'middle';
          ctx.textAlign = el.align || 'left';
          const tx = el.align === 'center' ? x + w / 2 : el.align === 'right' ? x + w - pad : x + pad;
          const lh = size * 1.2, y0 = y + hh / 2 - (lines.length - 1) * lh / 2;
          if (el.textShadow) shadow(ctx, true, 10 * k);
          if (el.font === 'arab') ctx.direction = 'rtl';
          lines.forEach((l, i) => {
            if (el.outline) { ctx.lineWidth = el.outline * sx; ctx.strokeStyle = el.outlineColor || '#000'; ctx.strokeText(l, tx, y0 + i * lh); }
            ctx.fillText(l, tx, y0 + i * lh);
          });
          ctx.direction = 'ltr';
        }
        ctx.restore();
      }
    }
  };

  const ANIM_DUR = 650;

  KM.titles = {
    THEMES, TPL,
    init(inp) {
      inp.opts = Object.assign({ template: 'lt-klasik', theme: 'emas', fields: {}, list: [], listIdx: 0, logo: '', cdEnd: 0, cdPausedLeft: null }, inp.opts);
      const W = KM.settings.width, H = KM.settings.height;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      inp.rt.canvas = c; inp.rt.ctx = c.getContext('2d');
      inp.rt.anim = { phase: 'shown', t0: 0 };
      KM.titles.loadLogo(inp);
      if (!inp.title || inp.title === 'Title UTC KLM Acara') inp.title = 'Title: ' + (TPL[inp.opts.template] || {}).name;
    },
    loadLogo(inp) {
      if (inp.opts.logo) { const i = new Image(); i.src = inp.opts.logo; inp.rt.logoImg = i; } else inp.rt.logoImg = null;
    },
    defs(inp) { const tpl = TPL[inp.opts.template] || TPL['lt-klasik']; return tpl.fieldsFor ? tpl.fieldsFor(inp) : tpl.fields; },
    fields(inp) {
      const out = {};
      KM.titles.defs(inp).forEach((fd) => { const v = inp.opts.fields[fd.k]; out[fd.k] = v == null || v === '' && fd.k === 'speed' ? fd.def : v; });
      return out;
    },
    progress(inp, now) {
      const an = inp.rt.anim;
      if (an.phase === 'shown') return 1;
      if (an.phase === 'hidden') return 0;
      const p = KM.clamp((now - an.t0) / ANIM_DUR, 0, 1);
      if (an.phase === 'in') { if (p >= 1) an.phase = 'shown'; return p; }
      if (p >= 1) { an.phase = 'hidden'; return 0; }
      return 1 - p;
    },
    render(inp, now) {
      const rt = inp.rt, W = KM.settings.width, H = KM.settings.height;
      if (rt.canvas.width !== W || rt.canvas.height !== H) { rt.canvas.width = W; rt.canvas.height = H; }
      const ctx = rt.ctx; ctx.clearRect(0, 0, W, H);
      const a = KM.titles.progress(inp, now); if (a <= 0) return;
      const tpl = TPL[inp.opts.template] || TPL['lt-klasik'];
      const th = THEMES[inp.opts.theme] || THEMES.emas;
      ctx.save();
      try { tpl.draw(ctx, W, H, KM.titles.fields(inp), th, a, now, H / 1080, inp); } catch (e) { console.error('title', e); }
      ctx.restore();
    },
    animIn(inp) { inp.rt.anim = { phase: 'in', t0: KM.now() }; },
    animOut(inp) { if (inp.rt.anim.phase !== 'hidden') inp.rt.anim = { phase: 'out', t0: KM.now() }; },
    hideNow(inp) { inp.rt.anim = { phase: 'hidden', t0: 0 }; },
    reset(inp) { inp.rt.anim = { phase: 'shown', t0: 0 }; },
    isHidden(inp) { return inp.rt.anim.phase === 'hidden'; },
    setField(inp, key, val) {
      const defs = KM.titles.defs(inp);
      let k = key;
      if (/^\d+$/.test(String(key))) { const fd = defs[parseInt(key, 10)]; if (fd) k = fd.k; }
      k = String(k).replace(/\.Text$/i, '');
      const exact = defs.find((f) => f.k.toLowerCase() === k.toLowerCase());
      if (exact) k = exact.k; else k = k.toLowerCase();
      if (!defs.find((f) => f.k === k)) {
        // alias gaya vMix: Headline/Name → field pertama, Description/Title → field kedua
        const al = { headline: 0, name: 0, nama: 0, description: 1, title: 1, ket: 1 };
        const fd = defs[al[k] != null ? al[k] : 0]; if (fd) k = fd.k;
      }
      inp.opts.fields[k] = val;
      KM.changed('title');
    },
    applyList(inp, idx) {
      const L = inp.opts.list; if (!L.length) return;
      inp.opts.listIdx = ((idx % L.length) + L.length) % L.length;
      const item = L[inp.opts.listIdx];
      KM.titles.defs(inp).forEach((fd, i) => { if (item[i] != null && item[i] !== '') inp.opts.fields[fd.k] = item[i]; });
      KM.changed('title');
    },
    next(inp) { KM.titles.applyList(inp, inp.opts.listIdx + 1); },
    prev(inp) { KM.titles.applyList(inp, inp.opts.listIdx - 1); },
    countdown(inp, cmd) {
      const o = inp.opts, f = KM.titles.fields(inp), total = (parseFloat(f.menit) || 0) * 60;
      if (cmd === 'start') { if (o.cdPausedLeft != null) { o.cdEnd = Date.now() + o.cdPausedLeft * 1000; o.cdPausedLeft = null; } else if (!o.cdEnd) o.cdEnd = Date.now() + total * 1000; }
      else if (cmd === 'pause') { if (o.cdEnd) { o.cdPausedLeft = Math.max(0, (o.cdEnd - Date.now()) / 1000); } }
      else if (cmd === 'reset') { o.cdEnd = 0; o.cdPausedLeft = null; }
      KM.changed('title');
    }
  };
})(window.KM);
