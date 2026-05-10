# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Personal academic webpage for Lucas Saunière, served from GitHub Pages at the repository root. Source lives under `src/`; generated HTML, the `static/` tree, and the compiled CV are emitted to the repo root so GitHub Pages can serve them directly.

## Commands

Build, serve, and clean go through the `Makefile`:

- `make build` — runs `uv run src/build.py`. Renders Jinja templates, normalizes publications from BibTeX, compiles the CV with `latexmk`, and copies static assets.
- `make serve` — builds, then `python -m http.server 8000` from the repo root.
- `make watch` — uses `watchexec` to rebuild on changes to `yml|bib|j2|css|js|html`.
- `make clean` — removes `src/build/` and CV LaTeX intermediates (does not delete generated HTML at the repo root).

Python deps are managed with `uv` (`pyproject.toml`, requires Python 3.13). External tools required for a full build: `latexmk` (with a TeX distribution that includes `moderncv`) and `watchexec` (for `make watch`).

## Architecture

**Static site generator in `src/build.py`** — single script, no framework. The build runs these steps in order:

1. **Legacy cleanup.** A hardcoded `LEGACY_ROOT_FILES` list deletes flat-layout artifacts (`animations.js`, `psf.js`, `euclid.js`, `theme.js`, `style.css`, `Background_hres.png`, etc.) from the repo root if found. This exists because the project migrated from a flat layout to `src/static/{js,css,3d,images}/`.
2. **Load YAML.** Every `*.yml` in `src/data/` is loaded by stem name into a `data` dict passed as kwargs to templates. `profile.yml` is the main content file; other files (`awards`, `software`, `talks`, etc.) feed both the site and the CV.
3. **Normalize publications.** `publications.bib` is parsed with `bibtexparser` and run through `normalize_publication()`, which flattens fields and applies `format_authors()` — a rule that bolds the user's surname (matching both "Sauniere" and "Saunière") and inserts "et al." after the user's name when the author list exceeds 10. Sorted by year descending.
4. **Render HTML.** Standard Jinja2 environment with `autoescape=True` and `StrictUndefined`. Templates ending in `.html.j2` (excluding `base.html.j2`) are rendered to the repo root with `.j2` stripped. The `page_active` dict in `build.py` maps each template to its nav highlight key — **add new pages there or the nav won't highlight them**.
5. **Render the CV.** A *second* Jinja environment is created with LaTeX-friendly delimiters (`((* *))`, `(((  )))`, `((= =))`) to avoid clashing with `{}` and `\`. It renders `cv.tex.j2` to `src/build/cv.tex`, then `latexmk` is invoked with `cwd=src/build` and `-outdir=../../cv`, producing `cv/cv.pdf`, which is copied to `cv/LucasSauniere_CV.pdf` (the public download URL).
6. **Copy static assets.** `src/static/` → `static/` at repo root, replacing the destination wholesale (`shutil.rmtree` then `copytree`). Templates therefore reference assets as `static/css/style.css`, `static/js/foo.js`, etc.
7. **Legacy `src/assets/`** — files there are copied flat to the repo root. Kept for backwards compat; prefer `src/static/`.

**Templates** (`src/templates/`). `base.html.j2` defines the shell: dark theme by default, GSAP + ScrollTrigger loaded from CDN, a Three.js import map for ES module imports, and nav with an `active` flag passed in from `build.py`. Pages extend it with `{% block title %}`, `{% block body_class %}`, `{% block content %}`, and an optional `{% block scripts %}`.

**Front-end animations** (`src/static/js/`). The home page (`index.html.j2`) is a 10-Act scrollytelling sequence — each section has an `id` and a `data-rail-target` attribute. `animations.js` is the single entry point (loaded as `type="module"` from `base.html.j2`); it owns Act 1 (the starfield + hero text), the entrance fades for later Acts, the right-edge progress rail (keyed off the `data-rail` / `data-rail-target` pair), and the snap-to-section ScrollTrigger that lands the viewport on each Act top when scroll is released. Scene modules are `import()`ed lazily when their section approaches the viewport, via the `lazy` table in `lazySceneLoaders` — section selector → module path. Current mapping: `#mission → euclid.js`, `#photon → psf.js`, `#problem → psf.js`, `#imaging → imaging.js`, `#measurement → measurement.js`, `#denoise → denoise.js`, `#network → network.js`, `#validation → validation.js`, `#focus-ramp → focusramp.js`. `psf.js` covers two Acts (3 and 4); listing it twice is fine because dynamic `import()` is cached per specifier and `psf.js` guards each `initActN` on `getElementById`. The Acts encode a research pipeline — Imaging motivates the PSF, Measurement gives raw stamps, Denoise (DDPM) cleans them, Network (Inception CNN) regresses Zernike coefficients, Validation checks residuals, Euclid shows the M2 focus campaign. The shared aberration parameters `{ defocus: 0.45, astigX: 0.55, comaX: 0.30 }` thread through `denoise.js` and `network.js` so the same PSF visibly flows from one Act to the next. `theme.js` is loaded separately from `base.html.j2` and handles the dark/light toggle and mobile menu. When adding a new Act, you need four edits in lockstep: a `<section>` with matching `id` + `data-rail-target`, a rail `<li>` in `index.html.j2`, an entry in `lazySceneLoaders.lazy`, an addition to `sectionSnap.ids`, and the `#id` in the `entranceAnimations` selector.

**Deployment**: served directly from the repo root on GitHub Pages (`master` branch). The generated HTML files (`index.html`, `about.html`, `research.html`, `papers.html`) and the `static/` and `cv/` directories are committed — they are build artifacts but also the deployed site.

## Gotchas

- `StrictUndefined` is used in both Jinja environments — a missing YAML key will fail the build rather than silently render empty. Add the key (even if empty) when introducing a new template reference.
- The HTML escapes by default but several templates pass fields through `| safe` (e.g. `profile.intro`, `profile.skills`, `profile.beyond_research`, paper authors). Those fields contain hand-written HTML in `profile.yml`; treat them as trusted content but don't introduce user-supplied data through them.
- Empty YAML files (`education.yml`, `experience.yml`, `posters.yml`, `skills.yml` are 0 bytes) load as `None` and become `[]` via the `or []` guard in `build.py`. The actual education/experience/skills data lives inside `profile.yml`.
- `make clean` does **not** wipe the generated HTML at the repo root — those are the deployed site. Delete them by hand only if you know what you're doing.
