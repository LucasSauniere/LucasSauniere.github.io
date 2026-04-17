import yaml, shutil, subprocess, pathlib
from jinja2 import Environment, FileSystemLoader
import bibtexparser

ROOT = pathlib.Path(__file__).parent.parent
SRC  = ROOT / "src"
OUT  = ROOT   # GitHub Pages serves root

# 1. Load all YAML data
data = {}
for yml in (SRC / "data").glob("*.yml"):
    data[yml.stem] = yaml.safe_load(yml.read_text())

# 2. Load publications from BibTeX
with open(SRC / "data" / "publications.bib") as f:
    data["publications"] = bibtexparser.load(f).entries

# 3. Render HTML pages
env_html = Environment(loader=FileSystemLoader(SRC / "templates"),
                       autoescape=True)
for tpl in (SRC / "templates").glob("*.html.j2"):
    name = tpl.name.replace(".j2", "")
    (OUT / name).write_text(env_html.get_template(tpl.name).render(**data))

# 4. Render LaTeX CV (different Jinja delimiters to avoid conflict with LaTeX)
env_tex = Environment(
    loader=FileSystemLoader(SRC / "templates"),
    block_start_string="((*", block_end_string="*))",
    variable_start_string="(((", variable_end_string=")))",
    comment_start_string="((=", comment_end_string="=))",
)
tex = env_tex.get_template("cv.tex.j2").render(**data)
(SRC / "build" / "cv.tex").write_text(tex)

# 5. Compile PDF
subprocess.run(["latexmk", "-pdf", "-outdir=../../cv", "cv.tex"],
               cwd=SRC / "build", check=True)

# 6. Copy static assets
for f in (SRC / "assets").iterdir():
    shutil.copy(f, OUT / f.name)