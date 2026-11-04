/* KLM Mix - efek GPU (WebGL): koreksi warna + chroma key */
'use strict';
(function (KM) {
  const VS = `attribute vec2 p; varying vec2 uv; void main(){ uv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;
  const FS = `precision mediump float;
  varying vec2 uv; uniform sampler2D tex;
  uniform float bri, con, sat, hue, gam;
  uniform float keyOn, sim, smo, spill; uniform vec3 keyCol;
  uniform float lumaOn, lumaLo, lumaHi;
  vec2 chroma(vec3 c){ return vec2(-0.1687*c.r-0.3313*c.g+0.5*c.b, 0.5*c.r-0.4187*c.g-0.0813*c.b); }
  vec3 hueRot(vec3 c, float a){
    const vec3 k = vec3(0.57735);
    float ca = cos(a);
    return c*ca + cross(k,c)*sin(a) + k*dot(k,c)*(1.0-ca);
  }
  void main(){
    vec4 s = texture2D(tex, uv);
    vec3 c = s.rgb; float a = s.a;
    if (keyOn > 0.5) {
      float d = distance(chroma(c), chroma(keyCol));
      float k = smoothstep(sim, sim + smo, d);
      a *= k;
      float lum = dot(c, vec3(0.2126,0.7152,0.0722));
      c = mix(vec3(lum), c, pow(clamp(d / max(spill,0.0001), 0.0, 1.0), 1.5));
    }
    if (lumaOn > 0.5) {
      float l = dot(c, vec3(0.2126,0.7152,0.0722));
      a *= smoothstep(lumaLo, lumaHi, l);
    }
    c = c + bri;
    c = (c - 0.5) * con + 0.5;
    float l2 = dot(c, vec3(0.2126,0.7152,0.0722));
    c = mix(vec3(l2), c, sat);
    if (hue != 0.0) c = hueRot(c, hue);
    c = pow(clamp(c,0.0,1.0), vec3(1.0/gam));
    gl_FragColor = vec4(c * a, a);
  }`;

  let gl = null, glCanvas = null, prog = null, tex = null, U = {};
  function init() {
    if (gl) return true;
    glCanvas = document.createElement('canvas');
    glCanvas.width = KM.settings.width; glCanvas.height = KM.settings.height;
    gl = glCanvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) { console.warn('WebGL tidak tersedia, efek dinonaktifkan'); return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    ['tex', 'bri', 'con', 'sat', 'hue', 'gam', 'keyOn', 'sim', 'smo', 'spill', 'keyCol', 'lumaOn', 'lumaLo', 'lumaHi'].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    return true;
  }

  function hex2rgb(hex) {
    const n = parseInt((hex || '#00ff00').replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  KM.fx = {
    needs(inp) {
      const c = inp.cc, k = inp.key;
      return !!((k && (k.on || k.lumaOn)) || (c && c.on && (c.bri !== 0 || c.con !== 1 || c.sat !== 1 || c.hue !== 0 || c.gam !== 1)));
    },
    /** proses sumber → kanvas 2D milik input. */
    process(inp, src, sw, sh) {
      if (!init() || !sw || !sh) return null;
      const W = glCanvas.width, H = glCanvas.height;
      let s = Math.min(1, W / sw, H / sh);
      const ow = Math.max(2, Math.round(sw * s)), oh = Math.max(2, Math.round(sh * s));
      const rt = inp.rt;
      if (!rt.fxCanvas) { rt.fxCanvas = document.createElement('canvas'); rt.fxCtx = rt.fxCanvas.getContext('2d'); }
      if (rt.fxCanvas.width !== ow || rt.fxCanvas.height !== oh) { rt.fxCanvas.width = ow; rt.fxCanvas.height = oh; }
      try { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }
      catch (e) { return null; }
      const c = inp.cc || {}, k = inp.key || {};
      const ccOn = !!c.on;
      gl.viewport(0, 0, ow, oh);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1i(U.tex, 0);
      gl.uniform1f(U.bri, ccOn ? (c.bri || 0) : 0);
      gl.uniform1f(U.con, ccOn ? (c.con == null ? 1 : c.con) : 1);
      gl.uniform1f(U.sat, ccOn ? (c.sat == null ? 1 : c.sat) : 1);
      gl.uniform1f(U.hue, ccOn ? ((c.hue || 0) * Math.PI / 180) : 0);
      gl.uniform1f(U.gam, ccOn ? (c.gam || 1) : 1);
      gl.uniform1f(U.keyOn, k.on ? 1 : 0);
      gl.uniform3fv(U.keyCol, hex2rgb(k.color));
      gl.uniform1f(U.sim, k.sim == null ? 0.4 : k.sim);
      gl.uniform1f(U.smo, k.smooth == null ? 0.08 : k.smooth);
      gl.uniform1f(U.spill, k.spill == null ? 0.1 : k.spill);
      gl.uniform1f(U.lumaOn, k.lumaOn ? 1 : 0);
      gl.uniform1f(U.lumaLo, k.lumaLo == null ? 0.05 : k.lumaLo);
      gl.uniform1f(U.lumaHi, k.lumaHi == null ? 0.15 : k.lumaHi);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      rt.fxCtx.clearRect(0, 0, ow, oh);
      rt.fxCtx.drawImage(glCanvas, 0, H - oh, ow, oh, 0, 0, ow, oh);
      return rt.fxCanvas;
    },
    resize() { if (glCanvas) { glCanvas.width = KM.settings.width; glCanvas.height = KM.settings.height; } }
  };
})(window.KM);
