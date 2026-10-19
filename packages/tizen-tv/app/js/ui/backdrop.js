// Adapted from samsucks (https://github.com/rfaile313/samsucks), GPL-3.0
// Full-screen ambience plus a cross-fading hero image.
//
// Painting a full-screen CSS gradient is slow on a TV CPU, so the ambience is
// a 2x2-pixel WebGL canvas (one pixel per corner): the compositor stretches
// the tiny texture over the screen and bilinear filtering makes the blend.
// Jellyfin has no UltraBlur colors, so the corners come from a 16x16 canvas
// sample of the hero image (quadrant averages). When the image is cross-origin
// without CORS the canvas is tainted; we then fall back to a warm palette.
import { h } from '../util/dom.js';

// [r,g,b] per corner: warm brown (left) to navy (bottom right), like the reference.
export const FALLBACK = { tl: [92, 50, 20], tr: [44, 34, 36], bl: [74, 36, 16], br: [24, 28, 66] };

function key(c) {
  return c ? c.tl.join(',') + '|' + c.tr.join(',') + '|' + c.bl.join(',') + '|' + c.br.join(',') : '';
}

// Saturate a little, then cap brightness so cream text stays readable.
function tone(rgb) {
  const l = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
  const c = rgb.map(function (v) { return Math.max(0, Math.min(255, l + (v - l) * 1.25)); });
  const peak = Math.max(c[0], c[1], c[2], 1);
  let f = peak > 86 ? 86 / peak : 1;
  if (peak * f < 22) f = 22 / peak;
  return c.map(function (v) { return Math.round(v * f); });
}

/** Four toned corner colors from a loaded <img>, or null when the canvas is tainted. */
export function sampleColors(img) {
  try {
    const cv = document.createElement('canvas');
    cv.width = 16;
    cv.height = 16;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    const sum = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]; // tl tr bl br: r g b n
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const q = (y < 8 ? 0 : 2) + (x < 8 ? 0 : 1);
        const i = (y * 16 + x) * 4;
        sum[q][0] += d[i]; sum[q][1] += d[i + 1]; sum[q][2] += d[i + 2]; sum[q][3]++;
      }
    }
    const avg = sum.map(function (s) { return tone([s[0] / s[3], s[1] / s[3], s[2] / s[3]]); });
    return { tl: avg[0], tr: avg[1], bl: avg[2], br: avg[3] };
  } catch (e) {
    return null;
  }
}

function createLayer(parent, className) {
  const canvas = h('canvas', className, null);
  parent.appendChild(canvas);
  canvas.width = 2;
  canvas.height = 2;
  const opts = { preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false };
  try {
    canvas._gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
  } catch (e) { canvas._gl = null; }
  if (!canvas._gl) canvas._ctx = canvas.getContext('2d');
  return canvas;
}

function paint(canvas, colors) {
  const c = colors || FALLBACK;
  const px = [c.tl, c.tr, c.bl, c.br];
  const gl = canvas._gl;
  if (gl) {
    gl.enable(gl.SCISSOR_TEST);
    for (let i = 0; i < 4; i++) {
      gl.scissor(i % 2, i < 2 ? 1 : 0, 1, 1); // GL's origin is bottom-left
      gl.clearColor(px[i][0] / 255, px[i][1] / 255, px[i][2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    return;
  }
  const img = canvas._ctx.createImageData(2, 2);
  for (let i = 0; i < 4; i++) {
    img.data[i * 4] = px[i][0]; img.data[i * 4 + 1] = px[i][1]; img.data[i * 4 + 2] = px[i][2]; img.data[i * 4 + 3] = 255;
  }
  canvas._ctx.putImageData(img, 0, 0);
}

class Ambience {
  constructor(parent) {
    this.el = h('div', 'ambience', null);
    parent.appendChild(this.el);
    this.layers = [createLayer(this.el, 'amb-layer on'), createLayer(this.el, 'amb-layer')];
    paint(this.layers[0], null);
    this.front = 0;
    this.key = key(FALLBACK);
  }

  set(colors) {
    const k = key(colors || FALLBACK);
    if (k === this.key) return;
    this.key = k;
    const back = 1 - this.front;
    paint(this.layers[back], colors);
    this.layers[back].classList.add('on');
    this.layers[this.front].classList.remove('on');
    this.front = back;
  }
}

let shared = null;

/** Per-screen handle on the shared ambience: remembers the screen's colors for restore(). */
export function useAmbience(initial) {
  if (!shared) {
    const holder = document.createElement('div');
    document.body.insertBefore(holder, document.body.firstChild);
    shared = new Ambience(holder);
  }
  let colors = initial || null;
  return {
    set: function (c) { colors = c || null; shared.set(colors); },
    restore: function () { shared.set(colors); },
  };
}

const colorCache = new Map();

/**
 * Two stacked <img> that cross-fade after the new one has decoded.
 * new HeroArt(parent, className, onColors(colors|null)); set(url) is cheap to call repeatedly.
 */
export class HeroArt {
  constructor(parent, className, onColors) {
    this.el = h('div', className || 'hero-art', null);
    if (parent) parent.appendChild(this.el);
    this.imgs = [h('img', 'hero-img', null), h('img', 'hero-img', null)];
    this.el.appendChild(this.imgs[0]);
    this.el.appendChild(this.imgs[1]);
    this.imgs[0].alt = '';
    this.imgs[1].alt = '';
    this.el.appendChild(h('div', 'hero-fade', null));
    this.front = 0;
    this.url = '';
    this.token = 0;
    this.onColors = onColors || null;
  }

  set(url) {
    if (url === this.url) return;
    this.url = url;
    const token = ++this.token;
    const self = this;
    if (!url) {
      this.imgs[0].classList.remove('on');
      this.imgs[1].classList.remove('on');
      if (this.onColors) this.onColors(null);
      return;
    }
    function show(cors, colors) {
      if (token !== self.token) return;
      const back = self.imgs[1 - self.front];
      if (cors) back.crossOrigin = 'anonymous';
      else back.removeAttribute('crossorigin');
      back.src = url;
      back.classList.add('on');
      self.imgs[self.front].classList.remove('on');
      self.front = 1 - self.front;
      if (self.onColors) self.onColors(colors);
    }
    function attempt(cors) {
      const loader = new Image();
      if (cors) loader.crossOrigin = 'anonymous';
      loader.src = url;
      const ok = function () {
        if (token !== self.token) return;
        let colors = colorCache.get(url) || null;
        if (!colors && cors) {
          colors = sampleColors(loader);
          if (colors) {
            colorCache.set(url, colors);
            if (colorCache.size > 80) colorCache.delete(colorCache.keys().next().value);
          }
        }
        show(cors && !!colors, colors);
      };
      const fail = function () {
        if (token !== self.token) return;
        if (cors) attempt(false);
        else if (self.onColors) self.onColors(null);
      };
      if (loader.decode) loader.decode().then(ok, fail);
      else { loader.onload = ok; loader.onerror = fail; }
    }
    attempt(true);
  }
}
