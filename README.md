# Metaball Morph Studio · 点阵形变动画工具

An animation editor for **autonomous-vehicle rear LED matrix signals (eHMI)**. Draw shapes / text / vector
paths, morph smoothly between keyframe states — either as **dot-matrix metaball morphs** or **solid vector
outline morphs** — and export PNG sequences / MP4 / WebM, or project the animation onto a 3D car model.

Doubles as a research instrument for HRI user testing and an 8/22 Woods-Gerry gallery show.

**Aesthetic north star: “Light doesn’t flash; it grows.”** No hard cuts, no strobing. Any 3–30 Hz brightness
oscillation is a photosensitivity red line and is forbidden.

> Two apps, both built to a single self-contained HTML file each:
> - `dist/index.html` — the **2D editor**
> - `dist/viewer.html` — the **3D car-model previewer**

## Quick start

```bash
npm install
npm run dev        # dev server on http://localhost:5173  (PORT=xxxx npm run dev if busy)
npm run build      # builds dist/index.html + dist/viewer.html (double-clickable)
npm test           # 76 pure-function assertions (node --test)
```

Runtime deps: `jszip` (PNG zip), `three` (3D), `mp4-muxer` (MP4). Vanilla JS ES modules, no framework.

## What it does

### 2D editor (`dist/index.html`)
- **Shapes**: rectangle, ellipse, text, and an **AE-style Bézier pen** (click = corner, click-drag = smooth
  handles, click-start / Enter / double-click = close; edit anchors & handles, Alt breaks handle symmetry).
- **Two morph styles, per shape** (「动画」selector):
  1. **Dot-ink dissolve** — the classic metaball morph: shapes break into dots that fly and reform.
  2. **Vector / puppet morph** — keyframe a shape, move its control points in the next keyframe, and the
     outline deforms along the shortest path per point (small, coherent — like AE’s puppet/path keyframing),
     filled solid the whole way (no dots).
- **🧱 Solid fill** — crisp vector edges (SDF), dissolving to dots in transitions.
- **Layers panel + real timeline** (AE-style): reorder / rename / hide / lock; segment bars ∝ duration,
  drag to scrub, drag edges to retime, double-click to edit a state.
- **Precision tools**: multi-select, align / distribute / equal-size / mirror / numeric array; persistent
  constraints (gap / equal / center / mirror to centerlines); CAD-style dimension annotations; snapping.
- **Per-state animation**: 📷 virtual camera (pan/zoom/rotate), 🔁 in-state loops (blink / walk),
  🌊 dynamic geometry (slosh / spring / liquid-line / ripple / twinkle, all ≤ 2.5 Hz for safety).
- **Canvas zoom/pan** with viewport rendering — vector data stays crisp at any zoom, constant cost.
- **Image import** (Otsu / halftone / colour k-means), image-sequence batch import, Ctrl+C/V across states,
  autosave, 🌐 中/English toggle.
- **Export**: PNG sequence (zip), 🎬 MP4 (WebCodecs H.264, deterministic offline), WebM recording. Preview
  and export share the exact same `sampleFrame`, so what you see is what you export.

### 3D previewer (`dist/viewer.html`)
Project the animation onto a car GLB via three modes: ① **Decal** (click-place, gumball manipulate),
② **🌀 Wrap** (continuous cylindrical skin), ③ **🧩 UV map** (Blender-unwrap workflow). Plus paint/erase
brushes, region cutter for running an animation across body panels, camera view controls, and Blender GLB export.

## Architecture (the iron rules)

- **The engine is pure.** `src/engine.js#sampleFrame(SEQ, states, g, time, P)` can be evaluated at any global
  time `g` from scratch — this is what makes the timeline scrubbable, exports deterministic, and preview ==
  export. Never add hidden state to it.
- **Data layer vs canvas objects are separate.** Serializable state (states/shapes) never holds canvas/ctx.
- **Project files stay backward-compatible** (reads v3 A/B and v4 states).
- **Performance red line**: solids/vectors are CPU per-pixel fields; crisp zoom comes from *viewport
  rendering* (render only the visible region), never from a bigger buffer.

### Source map
```
src/
  config.js      W/H, global params P, SDF resolution
  engine.js      pure: pairing, easing, sampleFrame, sequence, camera, loops, behaviors, morphLayers
  samplers.js    dot samplers + distanceField
  render.js      CPU tile field renderer (+ viewport view={z,ox,oy}) + solid SDF sampler
  render-gl.js   WebGL2 preview renderer
  vector.js      AE linked-layer / vector-outline & puppet morph
  pipeline.js    shapes → mask → dots / SDF (the only shapes↔canvas crossing)
  constraints.js persistent geometric constraints (gap/equal/center/mirror)
  path.js        Bézier + smooth path fill, RDP, bbox
  state.js       data model, undo/redo, project serialize
  export.js      PNG zip / MP4 / WebM
  image.js, shapes.js, sequence.js, store.js, utils.js, i18n.js, autosave.js
  ui/            toolbar, layers, timeline, inspector, filmstrip, stage, arrange, skinRef, imageImport
  viewer/main3d.js   the 3D car previewer
```

## Docs
- `Claude.md` — project charter / spec (read first).
- `PROGRESS.md` — current progress snapshot & roadmap (read second; for new sessions/collaborators).
- Git log — one detailed commit per feature.
