<div align="center">

<img src="logo.svg" width="96" alt="Liquid Pixel Studio logo">

# Liquid Pixel Studio

**Design liquid, metaball-style motion — then wrap it onto a 3D model.**
A browser-based keyframe animation tool for designers who *think* in animation and CAD
but aren't experts in After Effects or Blender.

[**▶ Live demo**](https://wendytang31.github.io/Liquid-Pixel-studio/) · runs in the browser, nothing to install

![tests](https://img.shields.io/badge/tests-106%20passing-2cc4f5) ![license](https://img.shields.io/badge/license-MIT-2cc4f5) ![runs in](https://img.shields.io/badge/runs%20in-browser-2cc4f5)

<div align="center">
   
<img width="400" height="400" alt="Frustration11-ezgif com-video-to-gif-converter" src="https://github.com/user-attachments/assets/b34182ca-158b-456a-9d7c-947ed85b93c1" />

</div>

---

## What it is

Liquid Pixel Studio is a **state‑machine animation editor**. You draw shapes as **states** (keyframes);
the tool interpolates between them with liquid **metaball** and **vector‑morph** motion, dot‑dissolves,
ink washes and edge effects. You can then **project the finished animation onto a 3D model** (a car, a
product, anything with a mesh) and preview it live — no render farm, no plugins.

Everything runs **client‑side**: your work stays in your browser (autosave + savable project files),
and publishing is just static hosting.

## Who it's for

- **Product / mobility / motion designers** who understand keyframes, easing and UV mapping conceptually,
  but don't want the full AE + Blender learning curve just to make one looping graphic.
- **HMI / signage / LED artists** who need a looping animated graphic mapped onto a physical surface.
- **Anyone** who wants organic "liquid pixel" motion — blobs merging, ink spreading — without writing shaders.

## How to use it

1. **Draw a state.** Pick a tool on the left (▭ rect, ◯ ellipse, ✎ pen) and draw on the canvas — this is keyframe 1.
2. **Add the next state.** Click **+ New State**, then move / redraw the shapes for keyframe 2. The tool animates between them.
3. **Choose how it moves** (right panel, per shape):
   - **In ← / Out →** — how each shape arrives and leaves: **vector morph**, **dot dissolve**, or **cut** (no anim).
   - **Constraint** — *self only* (morph to itself), *free* (morph to any nearby shape), *linked* (a chosen group
     morphs together), or *freeze* (never moves).
4. **Style it.** Dynamic Geometry (slosh / ripple / jagged / splatter), Ink Deposit (edge ink + bleed),
   stroke vs fill, colors, per‑state camera and in‑state loops (blink / walk).
   **🧪 Lab Physics** adds 26 more per‑state qualities — gravity sag, buoyancy, pressure, heartbeat,
   turbulence, vortex, wind, viscosity, melt, evaporate, attract/repel, lean, coherence, shatter,
   crystallize, sand, whip, tremor, bubble, boil, drip — plus `spring` / `anticipate` / `hesitate`
   easings. They're additive displacement fields, so they stack: a mix of sliders is a mix of physics.
5. **Preview.** Hit **▶ Preview** to loop the whole sequence.
6. **Put it on a 3D model.** **🚗 3D Preview** → load a `.glb` (or use the demo car) → project via **🧩 UV map**
   (Blender unwrap) or **🌀 Wrap** (cylindrical). Dim the model's own texture with **Model tex** so your animation reads.
7. **Save / export.** **💾 Save** a project file, or export **PNG sequence / MP4 / WebM**. Drag a saved `.json`
   back onto the editor to reopen it.

Language: switch **EN · 中 · 한** in the top‑left tab. Photosensitivity‑safe by design — motion *grows*, it never
strobes (all oscillation is held ≤ 2.5 Hz).

## Keyboard & mouse shortcuts

Nothing here is required — every action also has a button — but these make the workflow fast.

### 2D editor — tools & keys

| Key | Action |
|---|---|
| `V` | Select / move tool |
| `R` | Rectangle · `E` Ellipse · `T` Text · `D` Dot · `P` Pen |
| `Ctrl / ⌘ + Z` | Undo · `Ctrl / ⌘ + Shift + Z` (or `Ctrl + Y`) Redo |
| `Ctrl / ⌘ + C` / `V` | Copy / paste selected shapes — paste works in **any** state or layer |
| `Delete` / `Backspace` | Delete selected shape — *or*, if control points are selected, delete just those anchors (keeps ≥ 3) |
| `Esc` | Deselect all · cancel the pen mid‑draw |
| `← ↑ → ↓` | Nudge selection 1 px · **`Shift` + arrow** = 10 px |
| `Enter` | Finish / close the current pen path · **`Esc`** cancels it |
| `F` | Fit the car‑face reference to its UV island · **`Shift + F`** restores the full UV *(when the skin overlay is on and a face is selected)* |

### 2D editor — mouse & double‑click

| Gesture | Action |
|---|---|
| **Scroll wheel** | Zoom to cursor |
| **Middle‑drag** or **hold `Space` + drag** | Pan the canvas |
| **Double‑click** a circle / rectangle | Convert it to an **editable path** (unlocks anchors, curves, rigging) |
| **Double‑click** a path **anchor** | Delete it — on a bézier path, a *smooth* anchor first flips to a **corner**, a *corner* anchor flips to **smooth** (adds handles) |
| **Double‑click** an outline **segment** | Insert a new anchor there |
| **Right‑click** a shape / path | Context menu: show all curve handles · select all control points (for whole‑rig moves) · convert to path |
| **`Shift` + click** a filmstrip frame | Range‑select keyframes (for copy / paste / group move / scale) |
| **`Shift` + drag** a single anchor | Snap‑align to other anchors' vertical / horizontal / centre |
| **`Shift` + click** an anchor | Add / remove it from the control‑point selection |
| **`Shift`** while resizing | Proportional (locks aspect ratio) · **`Shift`** while rotating = 15° steps |
| **`Alt` + drag** a bézier handle | Break symmetry — move that handle independently |

### 3D viewer — keys & mouse

| Input | Action |
|---|---|
| `Q` `W` `B` `E` `C` | **Q** select · **W** place projection · **B** brush mask · **E** erase mask · **C** paint colour |
| `Space` | Play / pause the animation |
| `Ctrl / ⌘ + Z` | Undo · `Delete` removes the active projection · `Esc` deselects |
| **Double‑click** the model | Place a projection patch at that exact spot on the surface *(select mode)* |
| **Left‑drag** orbit · **scroll** zoom · **right / middle‑drag** pan | Standard orbit camera |

## Run locally

```bash
npm install
npm run dev      # editor on http://localhost:5173
npm run build    # static dist/  (index.html + viewer.html)
npm test         # 106 unit tests
```

The build is fully static — host `dist/` on **GitHub Pages / Cloudflare Pages / Netlify** for free.

## Under the hood

Vanilla JS + HTML canvas for the 2D engine (metaball fields, SDF solids, vector / puppet morphing),
**Three.js** for the 3D projection viewer, **Vite** for bundling. No framework, no backend.

The engine (`src/engine.js#sampleFrame`) is **pure** — any frame is computed from scratch at time `g`, which
is what makes the timeline scrubbable and **preview identical to export**. Serializable state never holds
canvas objects; project files stay backward‑compatible.

```
src/
  engine.js      pure: pairing, easing, sampleFrame, sequence, camera, loops
  vector.js      vector / puppet morph, constraints (self/linked/free/freeze)
  render.js      CPU tile field renderer + solid SDF sampler + ink deposit
  edgefx.js      edge geometry (fine wave / jagged / splatter)
  labfx.js       lab physics: 26 analytic displacement/emitter fields (emotion test bench)
  pipeline.js    shapes → mask → dots / SDF
  state.js       data model, undo/redo, project serialize
  export.js      PNG zip / MP4 / WebM
  ui/            toolbar, layers, timeline, inspector, stage, arrange, skinRef
  viewer/main3d.js   the 3D model previewer
```

## License

[MIT](LICENSE) © 2026 Wendy Tang
