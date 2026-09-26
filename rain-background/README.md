# Pioggia di luce

Sfondo animato con sottili linee verticali che cadono e particelle luminose che
brillano, ricreato a partire dall'hero del template
[Qronos](https://21st.dev/@monolythdev/templates/qronos-ai-agent-scheduler-template)
su 21st.dev.

Il codice è scritto da zero in Canvas 2D, senza dipendenze, e non contiene
codice del template originale. I parametri predefiniti sono stati tarati
misurando uno screenshot dell'originale.

| File | Contenuto |
| --- | --- |
| `rain-background.js` | L'effetto, come modulo ES |
| `index.html` | Demo con un pannello per regolare i parametri e copiare il codice |

## Vedere la demo

I moduli ES non si caricano aprendo il file con un doppio clic (`file://`),
quindi serve un piccolo server locale:

```bash
npx serve rain-background
# oppure
cd rain-background && python3 -m http.server
```

## Uso in una pagina HTML

Il canvas va dimensionato via CSS; la risoluzione interna si adatta da sola.

```html
<section class="hero">
  <canvas id="rain" aria-hidden="true"></canvas>
  <!-- titolo, testo, pulsanti… -->
</section>

<style>
  .hero { position: relative; isolation: isolate; background: #000; }
  .hero canvas { position: absolute; inset: 0; z-index: -1; width: 100%; height: 100%; }
</style>

<script type="module">
  import { createRainBackground } from './rain-background.js';
  createRainBackground(document.getElementById('rain'));
</script>
```

## Uso in React / Next.js

```jsx
'use client';
import { useEffect, useRef } from 'react';
import { createRainBackground } from './rain-background';

export function RainBackground(options) {
  const ref = useRef(null);
  useEffect(() => {
    const rain = createRainBackground(ref.current, options);
    return () => rain.destroy();
  }, []); // le opzioni valgono al montaggio; per cambiarle dopo usa rain.setOptions()
  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full" />;
}

// <section className="relative isolate bg-black">
//   <RainBackground speed={1.2} />
//   …
// </section>
```

## Opzioni

| Opzione | Predefinito | Effetto |
| --- | --- | --- |
| `color` | `'#ffffff'` | Colore di linee e particelle (qualsiasi colore CSS) |
| `density` | `8` | Linee ogni 100×100 px |
| `minLength`, `maxLength` | `10`, `110` | Lunghezza delle linee, in px |
| `speed` | `1` | Moltiplicatore della velocità di caduta |
| `opacity` | `1` | Moltiplicatore dell'opacità di tutto l'effetto |
| `topOpacity` | `0.12` | Opacità in cima rispetto al fondo: l'effetto sfuma verso l'alto |
| `centerBias` | `0.7` | Quanto le linee si addensano al centro (0 = distribuite in modo uniforme) |
| `dots` | `1.8` | Particelle ogni 100×100 px (0 = nessuna) |
| `dotSpeed` | `1` | Moltiplicatore della deriva delle particelle (0 = ferme) |
| `maxDpr` | `2` | Tetto al devicePixelRatio, per contenere il costo sugli schermi densi |

`createRainBackground()` restituisce un oggetto con `setOptions(opzioni)`,
`pause()`, `play()`, `paused` e `destroy()`.

## Come è stato ricostruito

Dall'analisi pixel per pixel dello screenshot dell'originale:

- le linee sono larghe 1 px e perfettamente verticali; ognuna ha la coda
  trasparente in alto, è piena dal 70% della lunghezza in giù e finisce con un
  taglio netto;
- tutte le linee hanno la stessa opacità, circa 0,23: le differenze di
  luminosità vengono da una sfumatura verticale lineare, dal 12% in cima al
  100% in fondo, che vale anche per le particelle;
- le lunghezze vanno da 10 a 110 px (mediana intorno ai 40) e le linee sono più
  fitte al centro che ai bordi;
- le particelle sono un pixel acceso con un alone di 2–6 px.

Un'immagine ferma non dice quanto veloce si muove l'animazione. Le linee cadono
tra circa 110 e 510 px/s, le più lunghe più veloci per dare profondità, e le
particelle scendono piano brillando. Se l'originale ti sembra più lento o più
veloce, regola `speed` dal pannello della demo e copia il codice.

## Prestazioni e accessibilità

- Linee e aloni sono sprite disegnati una volta sola: ogni frame costa un
  `drawImage` per elemento.
- L'animazione si ferma quando il canvas esce dallo schermo o la scheda è nascosta.
- Con `prefers-reduced-motion` attivo mostra un fotogramma fermo; `play()` la
  avvia comunque, per esempio da un pulsante.
- Il canvas è decorativo: tienilo con `aria-hidden="true"`.
