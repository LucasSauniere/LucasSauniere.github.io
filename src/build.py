import yaml, shutil, subprocess, pathlib
from jinja2 import Environment, FileSystemLoader, StrictUndefined
import bibtexparser

ROOT = pathlib.Path(__file__).parent.parent
SRC  = ROOT / "src"
OUT  = ROOT

# Ensure build dirs exist
(SRC / "build").mkdir(parents=True, exist_ok=True)
(ROOT / "cv").mkdir(parents=True, exist_ok=True)

def format_authors(raw: str) -> str:
    """Show all authors if ≤10, otherwise show up to and including Sauniere then 'et al.'"""
    if " and " in raw:
        parts = [a.strip() for a in raw.split(" and ")]
    else:
        parts = [a.strip() for a in raw.split(",")]

    # Bold my name wherever it appears
    formatted = []
    for author in parts:
        if "Sauniere" in author or "Saunière" in author:
            formatted.append("<b>L. Saunière</b>")
        else:
            formatted.append(author)

    if len(parts) <= 10:
        return ", ".join(formatted)

    # More than 10 authors: truncate after my name
    result = []
    for author, fmt in zip(parts, formatted):
        result.append(fmt)
        if "Sauniere" in author or "Saunière" in author:
            if author != parts[-1]:
                result.append("et al.")
            break
    else:
        # Sauniere not found — show first 3 + et al.
        result = formatted[:3] + (["et al."] if len(parts) > 3 else [])

    return ", ".join(result)

def normalize_publication(entry: dict) -> dict:
    """Map raw BibTeX fields to the keys used in templates."""
    venue = entry.get("journal") or entry.get("booktitle") or entry.get("publisher") or ""
    raw_authors = entry.get("author", "")
    authors = format_authors(raw_authors)
    # authors = entry.get("author", "").replace(" and ", ", ")
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

# debug: show top-level keys per file
for k, v in data.items():
    if isinstance(v, dict):
        print(f"  {k}.yml keys: {list(v.keys())}")
    else:
        print(f"  {k}.yml: {type(v).__name__} (len={len(v)})")

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
page_active = {
    "index.html.j2":    "home",
    "about.html.j2":    "about",
    "research.html.j2": "research",
    "papers.html.j2":   "papers",
}
for tpl in (SRC / "templates").glob("*.html.j2"):
    if tpl.name.startswith("base"):
        continue
    name = tpl.name.replace(".j2", "")
    rendered = env_html.get_template(tpl.name).render(
        **data,
        active=page_active.get(tpl.name, "")
    )
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

