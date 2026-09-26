/**
 * Pioggia di luce: sfondo animato con sottili linee verticali che cadono
 * e particelle luminose che brillano scendendo piano.
 *
 * Ricreato da zero, in Canvas 2D e senza dipendenze, a partire dall'analisi
 * dello sfondo dell'hero del template "Qronos" su 21st.dev.
 *
 *   import { createRainBackground } from './rain-background.js';
 *   const rain = createRainBackground(document.querySelector('#rain'), { speed: 1.2 });
 *   rain.setOptions({ density: 3 }); // cambia le opzioni al volo
 *   rain.pause(); rain.play();       // ferma / riprende l'animazione
 *   rain.destroy();                  // ferma tutto e scollega gli observer
 *
 * Il canvas va dimensionato via CSS (es. position: absolute; inset: 0;
 * width: 100%; height: 100%): la risoluzione interna si adatta da sola.
 */

export const DEFAULTS = Object.freeze({
  color: '#ffffff', // colore di linee e particelle (qualsiasi colore CSS)
  density: 8, // linee ogni 100×100 px
  minLength: 10, // lunghezza minima di una linea, in px
  maxLength: 110, // lunghezza massima di una linea, in px
  speed: 1, // moltiplicatore della velocità di caduta
  opacity: 1, // moltiplicatore dell'opacità di tutto l'effetto
  topOpacity: 0.12, // opacità in cima rispetto al fondo (1 = nessuna sfumatura)
  centerBias: 0.7, // 0 = linee sparse in modo uniforme, 1 = addensate al centro
  dots: 1.8, // particelle ogni 100×100 px (0 = nessuna)
  dotSpeed: 1, // moltiplicatore della deriva delle particelle (0 = ferme)
  maxDpr: 2, // tetto al devicePixelRatio, per contenere il costo sugli schermi densi
});

const STREAK_H = 256; // altezza dello sprite della linea, scalato alla lunghezza
const HALO_SIZE = 32; // lato dello sprite dell'alone, scalato al raggio

export function createRainBackground(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const o = { ...DEFAULTS, ...options };
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const streaks = [];
  const dots = [];
  let w = 0;
  let h = 0;
  let dpr = 1;
  let streakSprite;
  let haloSprite;
  let raf = 0;
  let last = 0;
  let clock = 0; // secondi di animazione: fermo quando l'animazione è ferma
  let paused = motion.matches; // chi chiede meno movimento vede un fotogramma fisso
  let onScreen = true;

  // Gli sprite si disegnano una volta sola: ogni frame costa un drawImage per elemento.
  function sprite(width, height, gradient) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const g = c.getContext('2d');
    g.fillStyle = gradient(g);
    g.fillRect(0, 0, width, height);
    // Colora la maschera bianca con o.color, così vale qualsiasi colore CSS.
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = o.color;
    g.fillRect(0, 0, width, height);
    return c;
  }

  function makeSprites() {
    // Linea: coda trasparente in alto, piena dal 70% in giù, taglio netto in fondo.
    // Tre colonne identiche, così lo scaling non sfuma i bordi laterali.
    streakSprite = sprite(3, STREAK_H, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, STREAK_H);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.7, '#fff');
      return grad;
    });
    // Alone della particella, che cala come (1 - r/R)^1,5; il nucleo è un pixel a parte.
    const r = HALO_SIZE / 2;
    haloSprite = sprite(HALO_SIZE, HALO_SIZE, (g) => {
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      for (let t = 0; t <= 1; t += 0.125) {
        grad.addColorStop(t, `rgba(255,255,255,${(1 - t) ** 1.5})`);
      }
      return grad;
    });
  }

  // Lunghezza, opacità e velocità restano quelle della nascita: a ogni giro
  // cambiano solo colonna e fase. Se si riestraessero, le linee corte (più lente,
  // quindi più a lungo sullo schermo) finirebbero per dominare.
  function newStreak() {
    const s = {
      // k fissa la lunghezza tra minLength e maxLength: nove linee su dieci
      // corte o medie, una lunga.
      k: Math.random() < 0.1 ? 0.6 + 0.4 * Math.random() : 0.6 * Math.random(),
      a: 0.21 + 0.04 * Math.random(),
    };
    respawnStreak(s);
    s.y = Math.random() * (h + lengthOf(s));
    return s;
  }

  function respawnStreak(s) {
    // Una parte delle linee nasce attorno al centro, le altre ovunque.
    s.u = Math.random() < o.centerBias ? (Math.random() + Math.random()) / 2 : Math.random();
    s.y = -40 * Math.random();
  }

  function newDot() {
    const d = {
      r: 2 + 4 * Math.random() ** 1.5, // raggio dell'alone, 2–6 px
      a: 0.55 + 0.3 * Math.random(),
      vy: 4 + 10 * Math.random(), // px/s
      tw: 0.6 + 1.6 * Math.random(), // velocità del brillio, rad/s
    };
    respawnDot(d);
    d.y = Math.random() * h;
    return d;
  }

  function respawnDot(d) {
    d.u = Math.random();
    d.ph = 2 * Math.PI * Math.random();
    d.y = -d.r;
  }

  const lengthOf = (s) => o.minLength + (o.maxLength - o.minLength) * s.k;

  // Opacità in funzione dell'altezza: l'effetto sfuma verso l'alto.
  const fade = (y) => o.topOpacity + (1 - o.topOpacity) * Math.min(Math.max(y / h, 0), 1);

  function fill(list, count, create) {
    list.length = Math.min(list.length, count);
    while (list.length < count) list.push(create());
  }

  function populate() {
    const tiles = (w * h) / 10000; // riquadri da 100×100 px
    fill(streaks, Math.round(tiles * o.density), newStreak);
    fill(dots, Math.round(tiles * o.dots), newDot);
  }

  function step(dt) {
    for (const s of streaks) {
      const len = lengthOf(s);
      // Più lunga = più vicina = più veloce: dà profondità.
      s.y += (70 + 4 * len) * o.speed * dt;
      if (s.y - len > h) respawnStreak(s);
    }
    for (const d of dots) {
      d.y += d.vy * o.dotSpeed * dt;
      if (d.y - d.r > h) respawnDot(d);
    }
  }

  function draw() {
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    const lw = Math.max(1, Math.round(dpr)); // 1 px CSS allineato ai pixel fisici
    for (const s of streaks) {
      const len = lengthOf(s);
      if (s.y <= 0 || s.y - len >= h) continue;
      ctx.globalAlpha = Math.min(1, s.a * o.opacity * fade(s.y));
      ctx.drawImage(streakSprite, 1, 0, 1, STREAK_H,
        Math.round(s.u * w * dpr), (s.y - len) * dpr, lw, len * dpr);
    }
    ctx.fillStyle = o.color;
    for (const d of dots) {
      const twinkle = 0.65 + 0.35 * Math.sin(clock * d.tw + d.ph);
      const sway = 3 * Math.sin(clock * 0.25 + d.ph);
      const alpha = d.a * twinkle * o.opacity * fade(d.y);
      // Nucleo: un pixel CSS pieno, allineato ai pixel fisici perché resti nitido.
      const px = Math.floor((d.u * w + sway) * dpr);
      const py = Math.floor(d.y * dpr);
      ctx.globalAlpha = Math.min(1, 0.45 * alpha);
      ctx.fillRect(px, py, lw, lw);
      // Alone centrato sul nucleo.
      const size = 2 * d.r * dpr;
      ctx.globalAlpha = Math.min(1, 0.55 * alpha);
      ctx.drawImage(haloSprite, px + lw / 2 - size / 2, py + lw / 2 - size / 2, size, size);
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05); // niente salti al ritorno da un tab nascosto
    last = now;
    clock += dt;
    step(dt);
    draw();
  }

  // Anima solo se non in pausa, visibile e con un'area da disegnare.
  function sync() {
    const run = !paused && onScreen && w > 0 && h > 0;
    if (run && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    populate();
    draw(); // subito: ridimensionare svuota il canvas, anche da fermo
    sync();
  }

  const ro = new ResizeObserver(resize);
  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    sync();
  });
  const onMotionChange = () => {
    paused = motion.matches;
    sync();
  };

  // Senza larghezza o altezza CSS il canvas prenderebbe la misura dalla propria
  // risoluzione interna e crescerebbe a ogni resize: lo si stende sul contenitore.
  for (const [attr, client] of [['width', 'clientWidth'], ['height', 'clientHeight']]) {
    const before = canvas[client];
    canvas[attr] += 10;
    if (canvas[client] !== before) canvas.style[attr] = '100%';
  }

  makeSprites();
  resize();
  ro.observe(canvas);
  io.observe(canvas);
  motion.addEventListener('change', onMotionChange);

  return {
    setOptions(next) {
      const recolor = next.color !== undefined && next.color !== o.color;
      const redpr = next.maxDpr !== undefined && next.maxDpr !== o.maxDpr;
      Object.assign(o, next);
      if (recolor) makeSprites();
      if (redpr) {
        resize();
      } else {
        populate();
        if (!raf) draw();
      }
    },
    play() {
      paused = false;
      sync();
    },
    pause() {
      paused = true;
      sync();
    },
    get paused() {
      return paused;
    },
    destroy() {
      paused = true;
      sync();
      ro.disconnect();
      io.disconnect();
      motion.removeEventListener('change', onMotionChange);
    },
  };
}
