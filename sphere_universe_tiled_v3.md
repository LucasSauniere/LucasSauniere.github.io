# `sphere_universe_tiled_v3.html`

## What it contains

A standalone Three.js web viewer that renders the Milky Way as the environment
of a reflective **mirror sphere** and overlays the **Euclid survey footprint** on
top of it. The Milky Way comes from a Mollweide-projected TIFF that is reprojected
to equirectangular in-browser; the footprint comes from the tiled delta sprites +
`manifest.json` produced by `euclid_tiles.py` (in `data/frames_tiled/`).

The footprint is drawn as the **white "leading edge"** only — each frame's delta
tiles are turned into white silhouettes (`whiteSilhouette`), so what you see is the
freshly-scanned strip glowing on the sphere, not a cumulative colored fill.

Instead of free scrubbing, playback is organized **by mission year**: frames are
grouped into year buckets from `manifest.dates` (`setupYearGroups`), each year is
reduced to a couple of keyframes, and the viewer crossfades between them using two
edge canvases (A/B) blended in `updateComposite`. Scrolling the wheel (or arrow
keys) snaps forward/back one year at a time, with a big animated year label flash.
There are two surface modes — **Mirror** (footprint reflected in the metal sphere
via a cube render target) and **Globe** (footprint painted directly on the sphere
as an emissive map) — plus drag/hover camera control and an idle auto-spin.

## What we're trying to achieve

A polished, presentation-style visualization of how Euclid's sky coverage builds up
over the mission, year by year, wrapped onto a mirror sphere. The goals:

- **Fast and light**: only load the tiles needed for the current/neighboring
  keyframes, never replay the whole survey — backward navigation is as cheap as
  forward.
- **Frontier look, not heatmap**: show the advancing white scan front rather than a
  filled cumulative patch.
- **Year-stepped storytelling**: a clean "Year 1 → Year 6" narrative with crossfades
  and a prominent year label, suited to demos/outreach rather than precise scrubbing.
