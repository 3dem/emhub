import datetime as dt

extensions = ['sphinx.ext.autodoc',
              'sphinx.ext.autosectionlabel',
              #'jaraco.packaging.sphinx',
              'rst.linker',
              'sphinxcontrib.napoleon',
              'sphinx_copybutton',
              ]

master_doc = "index"

exclude_patterns = ['js/*.rst']

link_files = {}

# Be strict about any broken references:
nitpicky = False

# Include Python intersphinx mapping to prevent failures
# jaraco/skeleton#51
#extensions += ['sphinx.ext.intersphinx']
# intersphinx_mapping = {
#     'python': ('https://docs.python.org/3', None),
# }

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

# Redirect old docs so links and references in the ecosystem don't break
extensions += ['sphinx_reredirects']
redirects = {
    "userguide/keywords": "/deprecated/changed_keywords.html",
}

# Add support for inline tabs
extensions += ['sphinx_inline_tabs']

# Support for distutils

# Ref: https://stackoverflow.com/a/30624034/595220
# FIXME: Add our own ignores
nitpick_ignore = [
    ('c:func', 'SHGetSpecialFolderPath'),  # ref to MS docs
    ('envvar', 'DISTUTILS_DEBUG'),  # undocumented
    ('envvar', 'HOME'),  # undocumented
    ('envvar', 'PLAT'),  # undocumented
    ('py:attr', 'CCompiler.language_map'),  # undocumented
    ('py:attr', 'CCompiler.language_order'),  # undocumented
    ('py:class', 'distutils.dist.Distribution'),  # undocumented
    ('py:class', 'distutils.extension.Extension'),  # undocumented
    ('py:class', 'BorlandCCompiler'),  # undocumented
    ('py:class', 'CCompiler'),  # undocumented
    ('py:class', 'CygwinCCompiler'),  # undocumented
    ('py:class', 'distutils.dist.DistributionMetadata'),  # undocumented
    ('py:class', 'FileList'),  # undocumented
    ('py:class', 'IShellLink'),  # ref to MS docs
    ('py:class', 'MSVCCompiler'),  # undocumented
    ('py:class', 'OptionDummy'),  # undocumented
    ('py:class', 'UnixCCompiler'),  # undocumented
    ('py:exc', 'CompileError'),  # undocumented
    ('py:exc', 'DistutilsExecError'),  # undocumented
    ('py:exc', 'DistutilsFileError'),  # undocumented
    ('py:exc', 'LibError'),  # undocumented
    ('py:exc', 'LinkError'),  # undocumented
    ('py:exc', 'PreprocessError'),  # undocumented
    ('py:func', 'distutils.CCompiler.new_compiler'),  # undocumented
    # undocumented:
    ('py:func', 'distutils.dist.DistributionMetadata.read_pkg_file'),
    ('py:func', 'distutils.file_util._copy_file_contents'),  # undocumented
    ('py:func', 'distutils.log.debug'),  # undocumented
    ('py:func', 'distutils.spawn.find_executable'),  # undocumented
    ('py:func', 'distutils.spawn.spawn'),  # undocumented
    # TODO: check https://docutils.rtfd.io in the future
    ('py:mod', 'docutils'),  # there's no Sphinx site documenting this
]

# Allow linking objects on other Sphinx sites seamlessly:
#intersphinx_mapping.update(
    #python2=('https://docs.python.org/2', None),
#     python=('https://docs.python.org/3', None),
# )

# Add support for the unreleased "next-version" change notes
# extensions += ['sphinxcontrib.towncrier']
# # Extension needs a path from here to the towncrier config.
# towncrier_draft_working_directory = '..'
# # Avoid an empty section for unpublished changes.
# towncrier_draft_include_empty = False

#extensions += ['jaraco.tidelift']

# Add icons (aka "favicons") to documentation
extensions += ['sphinx_favicon']
html_static_path = ['images']  # should contain the folder with icons

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
]


