"use client";

/**
 * RainBackground: sfondo animato con sottili linee verticali che cadono e
 * particelle luminose che brillano scendendo piano.
 *
 * Ricreato da zero in Canvas 2D, senza dipendenze oltre a React, a partire
 * dall'hero del template "Qronos" su 21st.dev. File unico: copialo per esempio
 * in components/ui/rain-background.tsx.
 *
 *   import { RainBackground } from "@/components/ui/rain-background";
 *
 *   <RainBackground className="min-h-screen bg-black text-white" speed={1.2}>
 *     <h1>Il tuo titolo</h1>
 *   </RainBackground>
 *
 * È un <div> con il canvas dietro ai figli: dagli sfondo e dimensioni con
 * className o style. Con "riduci movimento" attivo nel sistema mostra un
 * fotogramma fermo; la prop `paused` ferma l'animazione.
 */

import { useEffect, useRef, type ComponentPropsWithoutRef, type CSSProperties } from "react";

export interface RainOptions {
  /** Colore di linee e particelle (qualsiasi colore CSS). */
  color: string;
  /** Linee ogni 100×100 px. */
  density: number;
  /** Lunghezza minima di una linea, in px. */
  minLength: number;
  /** Lunghezza massima di una linea, in px. */
  maxLength: number;
  /** Moltiplicatore della velocità di caduta. */
  speed: number;
  /** Moltiplicatore dell'opacità di tutto l'effetto. */
  opacity: number;
  /** Opacità in cima rispetto al fondo: l'effetto sfuma verso l'alto (1 = nessuna sfumatura). */
  topOpacity: number;
  /** 0 = linee sparse in modo uniforme, 1 = addensate al centro. */
  centerBias: number;
  /** Particelle ogni 100×100 px (0 = nessuna). */
  dots: number;
  /** Moltiplicatore della deriva delle particelle (0 = ferme). */
  dotSpeed: number;
  /** Tetto al devicePixelRatio, per contenere il costo sugli schermi densi. */
  maxDpr: number;
}

const DEFAULTS: RainOptions = {
  color: "#ffffff",
  density: 8,
  minLength: 10,
  maxLength: 110,
  speed: 1,
  opacity: 1,
  topOpacity: 0.12,
  centerBias: 0.7,
  dots: 1.8,
  dotSpeed: 1,
  maxDpr: 2,
};

const STREAK_H = 256; // altezza dello sprite della linea, scalato alla lunghezza
const HALO_SIZE = 32; // lato dello sprite dell'alone, scalato al raggio

interface Streak {
  k: number; // posizione della lunghezza tra minLength e maxLength (0–1)
  a: number; // opacità
  u: number; // colonna, in frazione della larghezza
  y: number; // punta della linea, in px
}

interface Dot {
  r: number; // raggio dell'alone, in px
  a: number; // opacità
  vy: number; // velocità di discesa, in px/s
  tw: number; // velocità del brillio, in rad/s
  u: number; // colonna, in frazione della larghezza
  ph: number; // fase di brillio e ondeggiamento
  y: number; // centro, in px
}

interface Rain {
  setOptions(next: RainOptions): void;
  setPaused(paused: boolean): void;
  destroy(): void;
}

function createRain(canvas: HTMLCanvasElement, initial: RainOptions): Rain {
  const context = canvas.getContext("2d");
  if (!context) return { setOptions() {}, setPaused() {}, destroy() {} };
  const ctx: CanvasRenderingContext2D = context;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const streaks: Streak[] = [];
  const dots: Dot[] = [];
  let o = { ...initial };
  let w = 0;
  let h = 0;
  let dpr = 1;
  let streakSprite: HTMLCanvasElement;
  let haloSprite: HTMLCanvasElement;
  let raf = 0;
  let last = 0;
  let clock = 0; // secondi di animazione: fermo quando l'animazione è ferma
  let paused = false;
  let onScreen = true;

  // Gli sprite si disegnano una volta sola: ogni frame costa un drawImage per elemento.
  function sprite(width: number, height: number, gradient: (g: CanvasRenderingContext2D) => CanvasGradient) {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const g = c.getContext("2d")!;
    g.fillStyle = gradient(g);
    g.fillRect(0, 0, width, height);
    // Colora la maschera bianca con o.color, così vale qualsiasi colore CSS.
    g.globalCompositeOperation = "source-in";
    g.fillStyle = o.color;
    g.fillRect(0, 0, width, height);
    return c;
  }

  function makeSprites() {
    // Linea: coda trasparente in alto, piena dal 70% in giù, taglio netto in fondo.
    // Tre colonne identiche, così lo scaling non sfuma i bordi laterali.
    streakSprite = sprite(3, STREAK_H, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, STREAK_H);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.7, "#fff");
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

  const lengthOf = (s: Streak) => o.minLength + (o.maxLength - o.minLength) * s.k;

  // Opacità in funzione dell'altezza: l'effetto sfuma verso l'alto.
  const fade = (y: number) => o.topOpacity + (1 - o.topOpacity) * Math.min(Math.max(y / h, 0), 1);

  // Lunghezza, opacità e velocità restano quelle della nascita: a ogni giro
  // cambiano solo colonna e fase. Se si riestraessero, le linee corte (più lente,
  // quindi più a lungo sullo schermo) finirebbero per dominare.
  function respawnStreak(s: Streak) {
    // Una parte delle linee nasce attorno al centro, le altre ovunque.
    s.u = Math.random() < o.centerBias ? (Math.random() + Math.random()) / 2 : Math.random();
    s.y = -40 * Math.random();
  }

  function newStreak(): Streak {
    const s: Streak = {
      // Nove linee su dieci corte o medie, una lunga.
      k: Math.random() < 0.1 ? 0.6 + 0.4 * Math.random() : 0.6 * Math.random(),
      a: 0.21 + 0.04 * Math.random(),
      u: 0,
      y: 0,
    };
    respawnStreak(s);
    s.y = Math.random() * (h + lengthOf(s));
    return s;
  }

  function respawnDot(d: Dot) {
    d.u = Math.random();
    d.ph = 2 * Math.PI * Math.random();
    d.y = -d.r;
  }

  function newDot(): Dot {
    const d: Dot = {
      r: 2 + 4 * Math.random() ** 1.5,
      a: 0.55 + 0.3 * Math.random(),
      vy: 4 + 10 * Math.random(),
      tw: 0.6 + 1.6 * Math.random(),
      u: 0,
      ph: 0,
      y: 0,
    };
    respawnDot(d);
    d.y = Math.random() * h;
    return d;
  }

  function fill<T>(list: T[], count: number, create: () => T) {
    list.length = Math.min(list.length, count);
    while (list.length < count) list.push(create());
  }

  function populate() {
    const tiles = (w * h) / 10000; // riquadri da 100×100 px
    fill(streaks, Math.round(tiles * o.density), newStreak);
    fill(dots, Math.round(tiles * o.dots), newDot);
  }

  function step(dt: number) {
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
    ctx.imageSmoothingQuality = "high";
    const lw = Math.max(1, Math.round(dpr)); // 1 px CSS allineato ai pixel fisici
    for (const s of streaks) {
      const len = lengthOf(s);
      if (s.y <= 0 || s.y - len >= h) continue;
      ctx.globalAlpha = Math.min(1, s.a * o.opacity * fade(s.y));
      ctx.drawImage(streakSprite, 1, 0, 1, STREAK_H, Math.round(s.u * w * dpr), (s.y - len) * dpr, lw, len * dpr);
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

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05); // niente salti al ritorno da una scheda nascosta
    last = now;
    clock += dt;
    step(dt);
    draw();
  }

  // Anima solo se non in pausa, senza "riduci movimento", visibile e con un'area da disegnare.
  function sync() {
    const run = !paused && !motion.matches && onScreen && w > 0 && h > 0;
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
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) onScreen = entry.isIntersecting;
    sync();
  });

  makeSprites();
  resize();
  ro.observe(canvas);
  io.observe(canvas);
  motion.addEventListener("change", sync);

  return {
    setOptions(next) {
      const recolor = next.color !== o.color;
      const redpr = next.maxDpr !== o.maxDpr;
      o = { ...next };
      if (recolor) makeSprites();
      if (redpr) {
        resize();
      } else {
        populate();
        if (!raf) draw();
      }
    },
    setPaused(next) {
      paused = next;
      sync();
    },
    destroy() {
      paused = true;
      sync();
      ro.disconnect();
      io.disconnect();
      motion.removeEventListener("change", sync);
    },
  };
}

const CANVAS_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: -1,
  display: "block",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
};

export interface RainBackgroundProps extends Omit<ComponentPropsWithoutRef<"div">, "color">, Partial<RainOptions> {
  /** Ferma l'animazione lasciando visibile l'ultimo fotogramma. */
  paused?: boolean;
}

export function RainBackground({
  color,
  density,
  minLength,
  maxLength,
  speed,
  opacity,
  topOpacity,
  centerBias,
  dots,
  dotSpeed,
  maxDpr,
  paused = false,
  style,
  children,
  ...rest
}: RainBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rainRef = useRef<Rain | null>(null);

  // Le props non passate tornano al valore predefinito.
  const options: RainOptions = {
    color: color ?? DEFAULTS.color,
    density: density ?? DEFAULTS.density,
    minLength: minLength ?? DEFAULTS.minLength,
    maxLength: maxLength ?? DEFAULTS.maxLength,
    speed: speed ?? DEFAULTS.speed,
    opacity: opacity ?? DEFAULTS.opacity,
    topOpacity: topOpacity ?? DEFAULTS.topOpacity,
    centerBias: centerBias ?? DEFAULTS.centerBias,
    dots: dots ?? DEFAULTS.dots,
    dotSpeed: dotSpeed ?? DEFAULTS.dotSpeed,
    maxDpr: maxDpr ?? DEFAULTS.maxDpr,
  };
  const optionsKey = JSON.stringify(options);

  useEffect(() => {
    const rain = createRain(canvasRef.current!, DEFAULTS);
    rainRef.current = rain;
    return () => {
      rain.destroy();
      rainRef.current = null;
    };
  }, []);

  useEffect(() => {
    rainRef.current?.setOptions(JSON.parse(optionsKey) as RainOptions);
  }, [optionsKey]);

  useEffect(() => {
    rainRef.current?.setPaused(paused);
  }, [paused]);

  return (
    <div {...rest} style={{ position: "relative", isolation: "isolate", ...style }}>
      <canvas ref={canvasRef} aria-hidden="true" style={CANVAS_STYLE} />
      {children}
    </div>
  );
}

export default RainBackground;
