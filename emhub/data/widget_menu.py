# **************************************************************************
# *
# * Authors:     J.M. de la Rosa Trevin (delarosatrevin@gmail.com)
# *
# * Build protocol menus for the project widget from EMWRAP_CONFIG.
# *
# **************************************************************************

from emwrap.base import ProcessingConfig


def get_job_label(jobtype):
    job_conf = ProcessingConfig.get_job_conf(jobtype) or {}
    if label := job_conf.get('label'):
        return label

    job_form = ProcessingConfig.get_job_form(jobtype)
    if job_form:
        if label := job_form.get('label'):
            return label
        if title := job_form.get('title'):
            return title

    return jobtype


def _protocol_menu_item(jobtype):
    return {
        'text': get_job_label(jobtype),
        'value': jobtype,
        'tag': 'protocol',
    }


def _job_matches_prefix(jobtype, prefix):
    if not prefix:
        return False
    if jobtype == prefix or jobtype.startswith(prefix):
        return True
    trimmed = prefix.rstrip('-')
    if trimmed and jobtype == trimmed:
        return True
    if trimmed and not prefix.endswith('-') and jobtype.startswith(f'{trimmed}-'):
        return True
    return False


def _find_package_for_job(jobtype, packages):
    best_match = None
    best_len = -1
    for pkg in packages:
        for prefix in pkg.get('prefixes') or []:
            if _job_matches_prefix(jobtype, prefix):
                prefix_len = len(prefix.rstrip('-'))
                if prefix_len > best_len:
                    best_len = prefix_len
                    best_match = pkg['name']
    return best_match or 'emwrap'


def _section_menu_item(name, childs, open_item=True):
    return {
        'text': name,
        'icon': {'name': 'bookmark.gif'},
        'tag': 'section',
        'openItem': open_item,
        'childs': childs,
    }


def _all_menu_root(childs, open_item=True):
    return {
        'text': 'All',
        'openItem': open_item,
        'childs': childs,
    }


def _build_package_sections(grouped, packages):
    sections = []
    seen = set()
    for pkg in packages:
        name = pkg['name']
        seen.add(name)
        if grouped.get(name):
            sections.append(_section_menu_item(name, grouped[name]))

    for name, items in grouped.items():
        if name not in seen and items:
            sections.append(_section_menu_item(name, items))

    return sections


def get_widget_menu_protocols():
    """Build the protocols menu for the project widget from EMWRAP_CONFIG."""
    jobs = [
        jobtype for jobtype in ProcessingConfig.get_jobs()
        if ProcessingConfig.is_job_visible(jobtype)
    ]
    packages = ProcessingConfig.get_packages()

    if not packages:
        childs = sorted(
            (_protocol_menu_item(jobtype) for jobtype in jobs),
            key=lambda item: item['text'].lower(),
        )
        return {'All': _all_menu_root(childs)}

    grouped = {pkg['name']: [] for pkg in packages}
    grouped.setdefault('emwrap', [])

    for jobtype in jobs:
        pkg_name = _find_package_for_job(jobtype, packages)
        grouped.setdefault(pkg_name, []).append(_protocol_menu_item(jobtype))

    for items in grouped.values():
        items.sort(key=lambda item: item['text'].lower())

    sections = _build_package_sections(grouped, packages)
    return {'All': _all_menu_root(sections)}


def get_widget_menu():
    """Return menu_widget structure (protocols + workflows) from EMWRAP_CONFIG."""
    return {
        'protocols': get_widget_menu_protocols(),
        'workflows': [
            {
                'id': wf['id'],
                'name': wf['title'],
                'description': wf.get('description', ''),
                'tag': 'workflow',
            }
            for wf in ProcessingConfig.list_workflows()
        ],
    }


def fix_menu_icons(menu_item):
    if menu_item.get('tag') == 'protocol':
        if 'icon' not in menu_item:
            menu_item['icon'] = {'name': 'production.png'}
    elif 'childs' in menu_item:
        for child in menu_item['childs']:
            fix_menu_icons(child)


def fix_widget_menu_icons(menu):
    for section in menu.get('protocols', {}).values():
        fix_menu_icons(section)
