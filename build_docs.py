
import os
from emtools.utils import Process, Color


def main():
    Process.system("rm -rf html", color=Color.green)
    Process.system("sphinx-build -b html docs html", color=Color.green)
    Process.system("sphinx-build -b html docs/js html/js", color=Color.green)
    replace_content()


def replace_content():
    # Replace the article from: html/developer_guide/api/javascript.html
    # with the one here: html/js/index.html

    article_lines = []
    ref_lines = []
    in_article = False
    in_toc = False
    toc_lines = []

    js_index = 'html/js/index.html'

    if not os.path.exists(js_index):
        print(f"Missing file {js_index}, skipping.")
        return

    with open(js_index) as f:
        print(f"Parsing {Color.bold(js_index)}")
        for line in f:
            if '<article' in line:
                in_article = True
            elif 'article>' in line:
                in_article = False
            elif '<aside class="toc-drawer">' in line:
                in_toc = True
            elif '</aside>' in line:
                in_toc = False
            else:
                if in_article:
                    article_lines.append(line)
                elif in_toc:
                    toc_lines.append(line)

    all_lines = []
    in_toc = in_article = False

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
            elif '<aside class="toc-drawer">' in line:
                all_lines.append(line)  # toc line
                all_lines.extend(toc_lines)
                in_toc = True
            elif '</aside>' in line:
                in_toc = False

            if not in_article and not in_toc:
                all_lines.append(line)

    with open('html/developer_guide/api/javascript.html', 'w') as f:
        for line in all_lines:
            f.write(line)

    #Process.system("rm -rf html/js", color=Color.green)


if __name__ == '__main__':
    main()