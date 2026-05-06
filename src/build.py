import yaml, shutil, subprocess, pathlib
from jinja2 import Environment, FileSystemLoader, StrictUndefined
import bibtexparser

ROOT = pathlib.Path(__file__).parent.parent
SRC  = ROOT / "src"
OUT  = ROOT

# Ensure build dirs exist
(SRC / "build").mkdir(parents=True, exist_ok=True)
(ROOT / "cv").mkdir(parents=True, exist_ok=True)


def normalize_publication(entry: dict) -> dict:
    """Map raw BibTeX fields to the keys used in templates."""
    venue = entry.get("journal") or entry.get("booktitle") or entry.get("publisher") or ""
    authors = entry.get("author", "").replace(" and ", ", ")
    return {
        "id":       entry.get("ID", ""),
        "type":     entry.get("ENTRYTYPE", ""),
        "title":    entry.get("title", "").strip("{}"),
        "authors":  authors,
        "venue":    venue,
        "year":     entry.get("year", ""),
        "doi":      entry.get("doi", ""),
        "url":      entry.get("url", ""),
        "abstract": entry.get("abstract", ""),
    }


# 1. Load all YAML data
data = {}
for yml in (SRC / "data").glob("*.yml"):
    loaded = yaml.safe_load(yml.read_text()) or []
    data[yml.stem] = loaded

# 2. Load + normalize publications
bib_path = SRC / "data" / "publications.bib"
if bib_path.exists():
    with open(bib_path) as f:
        raw = bibtexparser.load(f).entries
    pubs = [normalize_publication(e) for e in raw]
    # Sort newest first
    pubs.sort(key=lambda p: p.get("year", ""), reverse=True)
    data["publications"] = pubs
else:
    data["publications"] = []

# 3. Render HTML pages
env_html = Environment(
    loader=FileSystemLoader(SRC / "templates"),
    autoescape=True,
    undefined=StrictUndefined,   # fail loudly on missing vars
)
for tpl in (SRC / "templates").glob("*.html.j2"):
    if tpl.name.startswith("base"):
        continue  # base.html.j2 is a layout template, not a standalone page
    name = tpl.name.replace(".j2", "")
    rendered = env_html.get_template(tpl.name).render(**data)
    (OUT / name).write_text(rendered)
    print(f"  wrote {name}")

# 4. Render LaTeX CV
env_tex = Environment(
    loader=FileSystemLoader(SRC / "templates"),
    block_start_string="((*", block_end_string="*))",
    variable_start_string="(((", variable_end_string=")))",
    comment_start_string="((=", comment_end_string="=))",
    undefined=StrictUndefined,
)
tex = env_tex.get_template("cv.tex.j2").render(**data)
(SRC / "build" / "cv.tex").write_text(tex)
print("  wrote src/build/cv.tex")

# 5. Compile PDF
subprocess.run(
    ["latexmk", "-pdf", "-interaction=nonstopmode", "-outdir=../../cv", "cv.tex"],
    cwd=SRC / "build",
    check=True,
)

# Rename the compiled PDF to the desired filename
cv_src = ROOT / "cv" / "cv.pdf"
cv_dst = ROOT / "cv" / "LucasSauniere_CV.pdf"
if cv_src.exists():
    shutil.copy2(cv_src, cv_dst)
    print(f"  renamed cv.pdf → LucasSauniere_CV.pdf")

# 6. Copy static assets (if any)
assets_dir = SRC / "assets"
if assets_dir.is_dir():
    for f in assets_dir.iterdir():
        if f.is_file():
            shutil.copy(f, OUT / f.name)
            print(f"  copied {f.name}")
else:
    print("  (no src/assets/ directory, skipping)")

print("Build OK.")

static_src = SRC / "static"
if static_src.exists():
    for f in static_src.iterdir():
        if f.is_file():
            shutil.copy2(f, OUT / f.name)
            print(f"  copied static/{f.name}")

