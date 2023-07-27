
from emtools.utils import Process, Color

Process.system("rm -rf html", color=Color.green)
Process.system("sphinx-build -b html docs html", color=Color.green)
Process.system("sphinx-build -b html docs/js html/js", color=Color.green)

# Replace the article from: html/developer_guide/api/javascript.html
# with the one here: html/js/index.html

article_lines = []
ref_lines = []
in_article = False

js_index = 'html/js/index.html'
with open(js_index) as f:
    print(f"Parsing {Color.bold(js_index)}")
    for line in f:
        if '<article' in line:
            in_article = True
        elif 'article>' in line:
            in_article = False
        else:
            if in_article:
                article_lines.append(line)
            if line.startswith('<li><a class="reference internal"'):
                ref_lines.append(line)

all_lines = []
in_article = False

js_file = 'html/developer_guide/api/javascript.html'
with open(js_file) as f:
    print(f"Parsing {Color.bold(js_file)}")
    for line in f:
        if '<article' in line:
            all_lines.append(line)  # article line
            all_lines.extend(article_lines)
            in_article = True
        elif 'article>' in line:
            in_article = False

        if not in_article:
            if line.startswith('<li><a class="reference internal"'):
                if ref_lines:
                    all_lines.extend(ref_lines)
                    ref_lines = []
            else:
                all_lines.append(line)

with open('html/developer_guide/api/javascript.html', 'w') as f:
    for line in all_lines:
        f.write(line)

Process.system("rm -rf html/js", color=Color.green)
