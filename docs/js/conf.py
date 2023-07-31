import datetime as dt

extensions = ['sphinx.ext.autodoc',
              'sphinx.ext.autosectionlabel',
              'rst.linker',
              'sphinxcontrib.napoleon',
              'sphinx_js']

master_doc = "index"

link_files = {}

# Be strict about any broken references:
nitpicky = False

# Add support for linking usernames
github_url = 'https://github.com'
github_repo_org = '3dem'
github_repo_name = 'emhub'
github_repo_slug = f'{github_repo_org}/{github_repo_name}'
github_repo_url = f'{github_url}/{github_repo_slug}'
github_sponsors_url = f'{github_url}/sponsors'
extlinks = {
    'user': (f'{github_sponsors_url}/%s', '@'),  # noqa: WPS323
    'pypi': ('https://pypi.org/project/%s', '%s'),  # noqa: WPS323
    'wiki': ('https://wikipedia.org/wiki/%s', '%s'),  # noqa: WPS323
}
extensions += ['sphinx.ext.extlinks']

# Ref: https://github.com/python-attrs/attrs/pull/571/files\
#      #diff-85987f48f1258d9ee486e3191495582dR82
default_role = 'any'

# HTML theme
html_theme = 'furo'
#html_logo = "images/emhub-logo-top.svg"
html_logo = "https://github.com/3dem/emhub/wiki/images/emhub-logo-top-gray.svg"

html_context = {
    'last_updated': dt.datetime.now().date()
}

templates_path = ["templates"]

html_theme_options = {

    "sidebar_hide_name": True,
    "light_css_variables": {
        "color-brand-primary": "#336790",  # "blue"
        "color-brand-content": "#336790",
    },
    "dark_css_variables": {
        "color-brand-primary": "#E5B62F",  # "yellow"
        "color-brand-content": "#E5B62F",
    },
}

# Add support for inline tabs
extensions += ['sphinx_inline_tabs']


# Add support for the unreleased "next-version" change notes
# extensions += ['sphinxcontrib.towncrier']
# # Extension needs a path from here to the towncrier config.
# towncrier_draft_working_directory = '..'
# # Avoid an empty section for unpublished changes.
# towncrier_draft_include_empty = False

#extensions += ['jaraco.tidelift']

# Add icons (aka "favicons") to documentation
extensions += ['sphinx_favicon']
#html_static_path = ['images']  # should contain the folder with icons

# List of dicts with <link> HTML attributes
# static-file points to files in the html_static_path (href is computed)
favicons = [
    {  # "Catch-all" goes first, otherwise some browsers will overwrite
        "rel": "icon",
        "type": "image/svg+xml",
        "static-file": "logo-symbol-only.svg",
        "sizes": "any"
    },
    {  # Version with thicker strokes for better visibility at smaller sizes
        "rel": "icon",
        "type": "image/svg+xml",
        "static-file": "favicon.svg",
        "sizes": "16x16 24x24 32x32 48x48"
    },
    # rel="apple-touch-icon" does not support SVG yet
]

# intersphinx_mapping['pip'] = 'https://pip.pypa.io/en/latest', None
# intersphinx_mapping['PyPUG'] = ('https://packaging.python.org/en/latest/', None)
# intersphinx_mapping['packaging'] = ('https://packaging.pypa.io/en/latest/', None)
# intersphinx_mapping['importlib-resources'] = (
#     'https://importlib-resources.readthedocs.io/en/latest', None
# )

# For sphinx_js
js_source_path = '../../emhub/static/libs/js/'
primary_domain = 'js'
