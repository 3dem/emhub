/* Config-driven tomogram viewer.

   createVolumeViewer($body, config) draws two tabs:
     - "Slices": IMOD-like layout, the Z section in the centre with the Y
       section above it and the X section on its right (same scale), a slider
       along each axis, crosshair lines and a toolbar.
     - "3D": three orthogonal planes in a rotatable three.js scene, of which
       only two can be active at a time, with its own toolbar.

   Everything works in voxel coordinates of the full volume.  The slice images
   may be downsampled; each image is stretched over its whole section, so the
   mapping from screen to voxels (and to Å through voxelSize) stays exact.

   config:
     dimensions   [X, Y, Z] voxels (required)
     axes         {x, y, z: {slice number: base64 PNG}} (required)
     voxelSize    Å per voxel: number, [x, y, z] or null when unknown
     coordinates  optional picked particles {x: [], y: [], z: []} in voxels
     idPrefix     unique prefix of element ids ('vv')
     info         optional text above the viewer
     tabs         {slices: true, view3d: true}
     tools        {select, ruler, zoom, pan, particles: 'auto', volume, invert}
                  (all true by default; 'auto': only if there are particles).
                  ruler, zoom and pan exist only in the Slices tab; volume
                  (faint whole tomogram) and invert (contrast) only in 3D.
                  The Clean button of the Slices tab resets the zoom, clears
                  the measurements and deactivates the active tool.
     initialTool  'select' | 'ruler' | 'zoom' | 'pan' | null  ('select')
     viewSize     longest side of the Z section in px (520)
     particleTolerance  slab half-thickness for particles in slices (10)
     onSelect     function({x, y, z}) called when the position changes by click
     threeUrl     override of the three.js module location

   Returns {destroy, getPosition, setPosition, setTool}.  A click that sets the
   position also triggers 'volumeviewer:select' on $body with {x, y, z}. */
(function() {

const THREE_URL = (function() {
    try {
        return new URL('../../vendor/three/three.module.min.js', document.currentScript.src).href;
    } catch (e) {
        return null;
    }
})();

function normVoxel(v) {
    const ok = function(n) { return (isFinite(n) && n > 0) ? Number(n) : null; };
    let r = null;
    if (Array.isArray(v) && v.length >= 3)
        r = {x: ok(v[0]), y: ok(v[1]), z: ok(v[2])};
    else if (v !== null && v !== undefined)
        r = {x: ok(v), y: ok(v), z: ok(v)};
    return (r && (r.x || r.y || r.z)) ? r : null;
}

function injectStyle() {
    if (document.getElementById('volume-viewer-style')) return;
    const css = [
        '.vv-info { font-size: .8rem; color: #6c757d; margin: 0 0 8px; }',
        '.vv-tabs { display: flex; gap: 4px; margin: 0 0 6px; padding: 0; list-style: none;',
        ' border-bottom: 1px solid #dee2e6; }',
        '.vv-tabs button { border: 0; background: none; padding: 5px 14px; font-size: .9rem;',
        ' color: #6c757d; border-bottom: 2px solid transparent; cursor: pointer; }',
        '.vv-tabs button.active { color: #1f77b4; border-bottom-color: #1f77b4; }',
        '.vv-toolbar { display: flex; gap: 4px; margin: 0 0 6px; align-items: center; }',
        '.vv-toolbar button { min-width: 32px; height: 30px; border: 1px solid #ced4da;',
        ' background: #fff; border-radius: 4px; color: #495057; cursor: pointer; padding: 0; }',
        '.vv-toolbar button:hover { background: #f1f3f5; }',
        '.vv-toolbar button.active { background: #1f77b4; border-color: #1f77b4; color: #fff; }',
        '.vv-toolbar .vv-sep { width: 1px; height: 20px; background: #dee2e6; margin: 0 4px; }',
        '.vv-grid { display: grid; grid-template-columns: max-content max-content;',
        ' gap: 6px 14px; align-items: start; }',
        '.vv-fig { position: relative; margin: 0; }',
        '.vv-fig canvas { display: block; }',
        '.vv-fig .vv-ov { position: absolute; left: 0; top: 0; }',
        '.vv-slider { font-size: .85em; }', '.vv-slider .vv-lbl { text-align: right; }',
        '.vv-slider input { display: block; margin: 0; }',
        '.vv-slider input.vv-vert { writing-mode: vertical-lr; width: 18px; }',
        '.vv-lbl { font-size: .85em; white-space: nowrap; }',
        '.vv-toolbar button.vv-txt { padding: 0 9px; font-size: .85rem; }',
        '.vv-toolbar .vv-arrows { display: inline-flex; gap: 2px; }',
        '.vv-out { margin-top: 6px; padding: 4px 10px; border: 1px solid #dee2e6; border-radius: 4px;',
        ' background: #f8f9fa; font-size: .85rem; font-variant-numeric: tabular-nums; min-height: 28px;',
        ' line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
        '.vv-out b { margin-left: 8px; } .vv-out b:first-child { margin-left: 0; }',
        '.vv-head { display: flex; align-items: flex-end; justify-content: space-between; }',
        '.vv-head .vv-tabs { flex: 1; }',
        '.vv-full-btn { border: 0; background: none; color: #6c757d; cursor: pointer; padding: 4px 8px; margin-bottom: 8px; }',
        '.vv-full-btn:hover { color: #1f77b4; }',
        '.vv:fullscreen, .vv.vv-fixed { background: #fff; padding: 12px 16px; overflow: auto; }',
        '.vv.vv-fixed { position: fixed; inset: 0; z-index: 3000; }',
        '.vv-fig canvas.vv-img { background: #000; }',
                '.vv-3d-wrap { display: flex; gap: 14px; align-items: flex-start; flex-wrap: wrap; }',
        '.vv-3d-canvas { position: relative; }',
        '.vv-3d-canvas canvas { display: block; cursor: grab; border-radius: 4px; }',
        '.vv-3d-ctrl { font-size: .8rem; width: 170px; }',
        '.vv-3d-ctrl .vv-row { margin: 0 0 4px; line-height: 1.2; }',
        '.vv-3d-ctrl input[type=range] { display: block; margin: 0; }',
        '.vv-3d-ctrl .vv-lbl { margin-top: -2px; }',
        '.vv-msg { color: #6c757d; font-size: .9rem; padding: 12px 0; }'
    ].join('\n');
    $('<style id="volume-viewer-style"></style>').text(css).appendTo(document.head);
}

function createVolumeViewer($body, config) {
    config = config || {};
    injectStyle();
    const d = config.dimensions, X = d[0], Y = d[1], Z = d[2];
    const dim = {x: X, y: Y, z: Z};
    const prefix = config.idPrefix || 'vv';
    const tabsCfg = Object.assign({slices: true, view3d: true}, config.tabs);
    const toolsCfg = Object.assign({select: true, ruler: true, zoom: true, pan: true, particles: 'auto',
                                    volume: true, invert: true, lines: true}, config.tools);
    const viewSize = config.viewSize || 520;
    const tol = (config.particleTolerance === undefined) ? 10 : config.particleTolerance;
    const dpr = window.devicePixelRatio || 1;
    // Screen pixels per voxel: the viewer is sized to fit the window without scrolling
    let full = false;
    // Space left below the top of the viewer, minus the tabs, toolbar, slider
    // labels and output bar that surround the images
    function room() {
        const top = Math.min(Math.max($body[0].getBoundingClientRect().top, 0), window.innerHeight / 2);
        return window.innerHeight - top;
    }
    function fitScale() {
        const availH = Math.max(200, room() - (full ? 190 : 238));
        const availW = Math.max(300, ($body.width() || window.innerWidth) - 40);
        const cap = full ? 4 : viewSize / Math.max(X, Y);
        return Math.min(cap, availH / (Y + Z), (availW - 14) / (X + Z));
    }
    function fit3d() {
        const h = Math.max(260, Math.min(full ? 4000 : 520, room() - (full ? 190 : 220)));
        return [Math.round(full ? Math.min(window.innerWidth - 260, h * 1.4) : h * 1.2), h];
    }
    let s = fitScale();
    $(window).on('resize.' + prefix, function() { relayout(); });
    const vs = normVoxel(config.voxelSize);
    const axes = config.axes;
    const AX = ['x', 'y', 'z'];

    const P = config.coordinates;
    const nPart = (P && P.x && P.y && P.z) ? Math.min(P.x.length, P.y.length, P.z.length) : 0;
    const hasParticles = nPart > 0 && toolsCfg.particles !== false;
    // Template map surface (vertices in Å) drawn at every particle in the 3D view
    const tmplData = (hasParticles && P.template && P.template.faces && P.template.faces.length) ? P.template : null;

    // Section axes: horizontal and vertical voxel axis of each view
    const HV = {z: ['x', 'y'], y: ['x', 'z'], x: ['z', 'y']};
    const size = {x: [Z, Y], y: [X, Z], z: [X, Y]};      // width, height in voxels

    const keys = {};
    AX.forEach(function(a) {
        keys[a] = Object.keys(axes[a]).map(Number).sort(function(p, q) { return p - q; });
    });
    function nearest(a, v) {
        const k = keys[a];
        let best = 0;
        for (let i = 1; i < k.length; i++)
            if (Math.abs(k[i] - v) < Math.abs(k[best] - v)) best = i;
        return best;
    }
    const clampVox = function(a, v) { return Math.max(0, Math.min(dim[a] - 1, Math.floor(v))); };

    const pos = {};
    AX.forEach(function(a) { pos[a] = keys[a][Math.floor(keys[a].length / 2)]; });

    const MODES = ['select', 'ruler', 'zoom', 'pan'];
    const allowed = MODES.filter(function(t) { return toolsCfg[t]; });
    let mode = (config.initialTool === undefined) ? 'select' : config.initialTool;
    if (allowed.indexOf(mode) < 0) mode = null;
    let partsOn = hasParticles;
    let sel = -1;                                         // selected particle
    const rulers = {x: null, y: null, z: null}, pend = {x: null, y: null, z: null};
    let destroyed = false;
    let lastView = 'z';                                   // view the pan arrows act on

    /* ---------- images ---------- */
    const imgCache = {};
    function getImg(a, key, onload) {
        const id = a + ':' + key;
        let c = imgCache[id];
        if (!c) {
            c = imgCache[id] = {img: new Image(), ready: false, cbs: []};
            c.img.onload = function() {
                c.ready = true;
                c.cbs.forEach(function(f) { f(); });
                c.cbs = [];
            };
            c.img.src = 'data:image/png;base64,' + axes[a][key];
        }
        if (c.ready) return c.img;
        if (onload) c.cbs.push(onload);
        return null;
    }

    /* ---------- measurement formatting ---------- */
    // dx, dy, dz: voxel differences
    function fmtLen(dx, dy, dz) {
        const vox = Math.hypot(dx, dy, dz);
        const d3 = {x: dx, y: dy, z: dz};
        const known = vs && AX.every(function(a) { return d3[a] === 0 || vs[a]; });
        if (!known) return vox.toFixed(1) + ' voxels (voxel size unknown)';
        const A = Math.hypot(dx * (vs.x || 0), dy * (vs.y || 0), dz * (vs.z || 0));
        return A.toFixed(1) + ' Å (' + (A / 10).toFixed(2) + ' nm) · ' + vox.toFixed(1) + ' voxels';
    }
    function rulerLen(a, r) {
        const dv = {x: 0, y: 0, z: 0};
        dv[HV[a][0]] = r.b[0] - r.a[0];
        dv[HV[a][1]] = r.b[1] - r.a[1];
        return fmtLen(dv.x, dv.y, dv.z);
    }

    /* ---------- DOM skeleton ---------- */
    const $root = $('<div class="vv"></div>').appendTo($body);
    if (config.info) $('<p class="vv-info"></p>').text(config.info).appendTo($root);
    const $tabs = $('<div class="vv-tabs"></div>');
    const $slices = $('<div class="vv-pane"></div>');
    const $p3 = $('<div class="vv-pane" style="display:none"></div>');
    const tabList = [];
    if (tabsCfg.slices) tabList.push(['slices', 'Slices']);
    if (tabsCfg.view3d) tabList.push(['view3d', '3D']);
    tabList.forEach(function(t) {
        $('<button type="button"></button>').text(t[1]).attr('data-tab', t[0]).appendTo($tabs);
    });
    const $head = $('<div class="vv-head"></div>').appendTo($root);
    $head.append(tabList.length > 1 ? $tabs : '<div style="flex:1"></div>');
    const $fullBtn = $('<button type="button" class="vv-full-btn" title="Full screen"><i class="fas fa-expand"></i></button>')
        .appendTo($head);
    const $out = $('<div class="vv-out"></div>');
    if (tabsCfg.slices) $root.append($slices);
    if (tabsCfg.view3d) $root.append($p3);
    $root.append($out);

    const SVG = function(inner) {
        return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
               'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
    };
    const ICON_RULER = SVG('<rect x="1" y="5" width="14" height="6" rx="1"/><path d="M4 5v3M7 5v2M10 5v3M13 5v2"/>');
    const ICON_PARTICLES = SVG('<circle cx="5" cy="5" r="2.5"/><circle cx="11" cy="6" r="2.5"/><circle cx="7" cy="11.5" r="2.5"/>');
    function toolButton(name, icon, title) {
        return $('<button type="button"></button>').attr({'data-tool': name, title: title})
            .append(icon.charAt(0) === '<' ? icon : '<i class="fas fa-' + icon + '"></i>');
    }
    const ICON_VOLUME = SVG('<path d="M8 1.5l6 3v7l-6 3-6-3v-7z" stroke-dasharray="2 2"/><path d="M2 4.5l6 3 6-3M8 7.5v7"/>');
    const ICON_TEMPLATE = SVG('<path d="M8 1.5l5.5 3.2v6.6L8 14.5l-5.5-3.2V4.7z"/><path d="M8 8.2l5.5-3.5M8 8.2L2.5 4.7M8 8.2v6.3"/>');
    function addParticleTools($t, is3d) {
        if (!hasParticles) return;
        $t.append(toolButton('particles', ICON_PARTICLES, 'Show and inspect picked particles'));
        $t.append(toolButton('prev', 'chevron-left', 'Previous particle'));
        $t.append(toolButton('next', 'chevron-right', 'Next particle'));
        if (is3d && tmplData && vs)
            $t.append(toolButton('template', ICON_TEMPLATE, 'Show the picking template at every particle, with its orientation'));
    }
    function buildToolbar(kind) {
        const $t = $('<div class="vv-toolbar"></div>');
        const slices = kind === 'slices';
        if (toolsCfg.select) $t.append(toolButton('select', 'crosshairs', 'Select a point: moves the sliders there'));
        if (toolsCfg.ruler && slices)
            $t.append(toolButton('ruler', ICON_RULER, 'Ruler: click two points to measure'));
        if (toolsCfg.zoom && slices)
            $t.append(toolButton('zoom', 'search-plus', 'Zoom: drag a rectangle over the region to enlarge'));
        if (toolsCfg.pan && slices) {
            $t.append(toolButton('pan', 'arrows-alt', 'Move the zoomed section: drag it with the mouse'));
        }
        if (slices && toolsCfg.invert) $t.append(toolButton('invert', 'adjust', 'Invert the contrast'));
        if (slices && toolsCfg.lines) $t.append(toolButton('lines', 'eye-slash', 'Hide the slice lines (crosshair)'));
        if (slices) addParticleTools($t);
        if (slices && (toolsCfg.ruler || toolsCfg.zoom || toolsCfg.pan || toolsCfg.invert))
            $t.append(toolButton('clean', 'undo', 'Clean: reset the zoom, remove measurements, restore the contrast and deactivate the tool'));
        if (!slices) {
            $t.append('<span class="vv-sep"></span>');
            if (toolsCfg.volume) $t.append(toolButton('volume', ICON_VOLUME, 'Show the whole tomogram as a faint volume'));
            if (toolsCfg.invert) $t.append(toolButton('invert', 'adjust', 'Invert the contrast'));
            if (toolsCfg.pan) $t.append(toolButton('pan', 'arrows-alt', 'Move the volume: drag it in any direction (or right-drag / shift+drag)'));
            addParticleTools($t, true);
            $t.append(toolButton('reset3d', 'sync-alt', 'Reset the 3D view'));
        }
        return $t;
    }
    const $tb = {slices: buildToolbar('slices'), view3d: buildToolbar('3d')};

    function syncToolbars() {
        Object.keys($tb).forEach(function(k) {
            $tb[k].find('button').each(function() {
                const t = $(this).attr('data-tool');
                if (MODES.indexOf(t) >= 0) $(this).toggleClass('active', mode === t);
                if (t === 'particles') $(this).toggleClass('active', partsOn);
                if (t === 'prev' || t === 'next') $(this).toggle(partsOn);
                if (t === 'volume') $(this).toggleClass('active', volOn);
                if (t === 'template') $(this).toggleClass('active', tmplOn);
                if (t === 'invert') $(this).toggleClass('active', inverted);
                if (t === 'lines') $(this).toggleClass('active', hideLines);
            });
        });
        AX.forEach(function(a) {
            if (views[a]) views[a].canvas.style.cursor = mode === 'pan' ? 'grab' : (mode ? 'crosshair' : 'default');
        });
    }
    function setTool(t) {
        mode = (allowed.indexOf(t) >= 0 && t !== mode) ? t : null;
        syncToolbars();
        drawOverlays();
        updateReadout();
    }
    /* Undo: every zoom, ruler and contrast change is one step; each click on
       the button goes back one step. With nothing left to undo it only
       deactivates the active tool. */
    const history = [];
    let hideLines = false;
    function clean() {
        drag = null;
        const h = history.pop();
        if (!h) {
            mode = null;
            AX.forEach(function(a) { pend[a] = null; });
        } else if (h.type === 'zoom') {
            views[h.a].win = h.win;
        } else if (h.type === 'ruler') {
            rulers[h.a] = h.prev;
            pend[h.a] = null;
        } else if (h.type === 'invert') {
            toggleInvert(true);
            return;
        } else if (h.type === 'lines') {
            hideLines = !hideLines;
        }
        syncToolbars();
        drawAll();
        updateReadout();
    }
    function stepParticle(dir) {
        if (!nPart) return;
        selectParticle(sel < 0 ? (dir > 0 ? 0 : nPart - 1) : (sel + dir + nPart) % nPart);
    }
    Object.keys($tb).forEach(function(k) {
        $tb[k].on('click', 'button', function() {
            const t = $(this).attr('data-tool');
            if (MODES.indexOf(t) >= 0) setTool(t);
            else if (t === 'particles') { partsOn = !partsOn; syncToolbars(); refresh(); }
            else if (t === 'clean') clean();
            else if (t === 'volume') toggleVolume();
            else if (t === 'template') { tmplOn = !tmplOn; syncToolbars(); sync3D(); }
            else if (t === 'invert') toggleInvert(false);
            else if (t === 'lines') {
                history.push({type: 'lines'});
                hideLines = !hideLines;
                syncToolbars();
                drawAll();
            }
            else if (t === 'prev') stepParticle(-1);
            else if (t === 'next') stepParticle(1);
            else if (t === 'reset3d') reset3dView();
        });
    });

    function emit() {
        const p = {x: pos.x, y: pos.y, z: pos.z};
        $body.trigger('volumeviewer:select', [p]);
        if (typeof config.onSelect === 'function') config.onSelect(p);
    }
    function setPos(p, fromUser) {
        AX.forEach(function(a) {
            if (p[a] !== undefined) pos[a] = p[a];
        });
        refresh();
        if (fromUser) emit();
    }
    // The position holds exact voxels; sections show the nearest slice
    function selectParticle(i) {
        sel = i;
        setPos({x: clampVox('x', P.x[i]), y: clampVox('y', P.y[i]), z: clampVox('z', P.z[i])}, true);
    }

    /* ---------- readout ---------- */
    // The output bar below the toolbox shows one thing at a time, depending on the active tool
    function scaleText() {
        if (!vs) return 'voxel size unknown';
        const v = vs.x || vs.y || vs.z;
        return v ? v.toFixed(2) + ' Å/voxel' : 'voxel size unknown';
    }
    function updateReadout() {
        let h;
        const meas = [];
        if (mode === 'ruler') AX.forEach(function(a) {
            if (rulers[a]) meas.push(rulerLen(a, rulers[a]));
        });
        if (mode === 'ruler') {
            h = meas.length ? '<b>Length</b> ' + meas[meas.length - 1] : 'Ruler: click two points to measure';
        } else if (sel >= 0 && hasParticles) {
            h = '<b>Particle ' + (sel + 1) + '/' + nPart + '</b> (' + P.x[sel] + ', ' + P.y[sel] + ', ' + P.z[sel] + ')';
        } else if (mode === 'select') {
            h = '<b>X</b> ' + pos.x + ' <b>Y</b> ' + pos.y + ' <b>Z</b> ' + pos.z + ' &nbsp;·&nbsp; ' + scaleText();
        } else {
            h = scaleText();
        }
        $out.html(h);
    }

    /* ---------- Slices tab ---------- */
    const views = {};
    function resetZoom(a) {
        views[a].win = {x0: 0, y0: 0, w: size[a][0], h: size[a][1]};
    }
    const sliders = {};
    function buildSlices() {
        $slices.append($tb.slices);
        const $grid = $('<div class="vv-grid"></div>').appendTo($slices);
        const mkFig = function(a) {
            const cw = size[a][0] * s, ch = size[a][1] * s;
            return {cw: cw, ch: ch, html: '<div id="' + prefix + '-' + a + '"><figure class="vv-fig" style="width:' +
                cw + 'px;height:' + ch + 'px"><canvas class="vv-img"></canvas><canvas class="vv-ov"></canvas></figure></div>'};
        };
        /* Each slider is as wide as the section it sits next to (but never
           too short to use), with its slice number below it. */
        const mkSlider = function(a, vertical) {
            const len = Math.max(size[a === 'x' ? 'x' : 'z'][0] * s, 110);
            const $el = $('<div class="vv-slider"></div>');
            const $in = $('<input type="range" min="0" step="1">').attr('max', dim[a] - 1).appendTo($el);
            const $lbl = $('<div class="vv-lbl"></div>');
            if (vertical) { $in.addClass('vv-vert').css('height', len); }
            else { $in.css('width', len); $el.append($lbl); }
            $in.on('input', function() {
                pos[a] = Number($(this).val());
                refresh();
                emit();
            });
            sliders[a] = {$in: $in, $lbl: $lbl};
            return $el;
        };
        const fig = {y: mkFig('y'), z: mkFig('z'), x: mkFig('x')};
        // IMOD-like: Y section on top, Z in the centre, X on the right
        $grid.append(mkSlider('y', false)).append('<div></div>');
        $grid.append(fig.y.html).append('<div></div>');
        $grid.append(fig.z.html).append(fig.x.html);
        $grid.append(mkSlider('z', false)).append(mkSlider('x', false));
        ['y', 'z', 'x'].forEach(function(a) {
            const cw = fig[a].cw, ch = fig[a].ch, $v = $grid.find('#' + prefix + '-' + a);
            const v = views[a] = {$el: $v, cw: cw, ch: ch, hover: null};
            resetZoom(a);
            ['img', 'ov'].forEach(function(n) {
                const c = $v.find('canvas.vv-' + n)[0];
                c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
                c.style.width = cw + 'px'; c.style.height = ch + 'px';
                v[n] = c.getContext('2d');
                v[n].setTransform(dpr, 0, 0, dpr, 0, 0);
            });
            v.canvas = $v.find('canvas.vv-ov')[0];
            v.canvas.style.cursor = 'crosshair';
            $(v.canvas).on('mousemove', function(e) {
                lastView = a;
                const r = v.canvas.getBoundingClientRect();
                v.hover = [e.clientX - r.left, e.clientY - r.top];
                if (drag && drag.a === a) {
                    drag.x = v.hover[0]; drag.y = v.hover[1];
                    if (drag.type === 'pan') {
                        panDrag(a);
                        drag.x0 = drag.x; drag.y0 = drag.y;
                    } else drawOverlay(a);
                } else if (pend[a]) drawOverlay(a);
            }).on('mouseleave', function() {
                v.hover = null;
                drawOverlay(a);
            }).on('mousedown', function(e) {
                if (e.button !== 0) return;
                lastView = a;
                const r = v.canvas.getBoundingClientRect();
                const x = e.clientX - r.left, y = e.clientY - r.top;
                if (mode === 'zoom' || mode === 'pan') {
                    drag = {a: a, type: mode, x0: x, y0: y, x: x, y: y};
                    e.preventDefault();
                }
            }).on('click', function(e) { onClick(a, e); });
        });
    }
    let drag = null;
    function endDrag() {
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.type === 'zoom') zoomTo(d);
        drawOverlay(d.a);
    }
    $(document).on('mouseup.' + prefix, endDrag);

    const sv = function(a) { return views[a].cw / views[a].win.w; };
    function toVox(a, cx, cy) {
        const v = views[a], k = sv(a);
        return [v.win.x0 + cx / k, v.win.y0 + cy / k];
    }
    function toPx(a, h, vv) {
        const v = views[a], k = sv(a);
        return [(h - v.win.x0) * k, (vv - v.win.y0) * k];
    }

    /* The section is only redrawn when its slice or zoom changed, and the
       previous picture stays until the next image has loaded, so moving a
       slider never flashes a blank frame. */
    function drawImage(a) {
        const v = views[a], key = keys[a][nearest(a, pos[a])];
        const w = v.win, stamp = [key, w.x0, w.y0, w.w, w.h].join(',');
        if (v.drawn === stamp) return;
        const img = getImg(a, key, function() {
            if (!destroyed && keys[a][nearest(a, pos[a])] === key) drawImage(a);
        });
        if (!img) return;
        const rx = img.naturalWidth / size[a][0], ry = img.naturalHeight / size[a][1];
        v.img.drawImage(img, w.x0 * rx, w.y0 * ry, w.w * rx, w.h * ry, 0, 0, v.cw, v.ch);
        v.drawn = stamp;
    }

    function label(ctx, text, x, y) {
        ctx.font = '12px sans-serif';
        const w = ctx.measureText(text).width + 8;
        const lx = Math.max(2, Math.min(x, ctx.canvas.width / dpr - w - 2));
        const ly = Math.max(16, y);
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.fillRect(lx, ly - 14, w, 18);
        ctx.fillStyle = '#ffd43b';
        ctx.fillText(text, lx + 4, ly - 1);
    }

    function drawOverlay(a) {
        const v = views[a], ctx = v.ov, [ha, va] = HV[a];
        ctx.clearRect(0, 0, v.cw, v.ch);
        // Crosshair lines of the other two sections
        const c = toPx(a, pos[ha] + 0.5, pos[va] + 0.5);
        if (!hideLines) {
        ctx.strokeStyle = 'rgba(0,229,255,.9)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        if (c[0] >= 0 && c[0] <= v.cw) { ctx.moveTo(c[0], 0); ctx.lineTo(c[0], v.ch); }
        if (c[1] >= 0 && c[1] <= v.ch) { ctx.moveTo(0, c[1]); ctx.lineTo(v.cw, c[1]); }
        ctx.stroke();
        }

        if (partsOn) {
            for (let i = 0; i < nPart; i++) {
                if (Math.abs(P[a][i] - pos[a]) > tol) continue;
                const p = toPx(a, P[ha][i] + 0.5, P[va][i] + 0.5);
                if (p[0] < -8 || p[1] < -8 || p[0] > v.cw + 8 || p[1] > v.ch + 8) continue;
                ctx.beginPath();
                ctx.arc(p[0], p[1], i === sel ? 4 : 2.5, 0, 2 * Math.PI);
                ctx.fillStyle = i === sel ? '#ff3b30' : '#ffa500';
                ctx.fill();
                ctx.lineWidth = 1;
                ctx.strokeStyle = 'rgba(0,0,0,.6)';
                ctx.stroke();
            }
        }

        const key = keys[a][nearest(a, pos[a])];
        const r = rulers[a];
        const seg = function(p, q, text) {
            const A = toPx(a, p[0], p[1]), B = toPx(a, q[0], q[1]);
            ctx.strokeStyle = '#ffd43b';
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
            [A, B].forEach(function(e) {
                ctx.beginPath(); ctx.arc(e[0], e[1], 3, 0, 2 * Math.PI);
                ctx.fillStyle = '#ffd43b'; ctx.fill();
            });
            if (text) label(ctx, text, (A[0] + B[0]) / 2 + 6, (A[1] + B[1]) / 2 - 6);
        };
        if (mode === 'ruler' && r && r.key === key) seg(r.a, r.b, rulerLen(a, r));
        if (mode === 'ruler' && pend[a] && v.hover) {
            const q = toVox(a, v.hover[0], v.hover[1]);
            seg(pend[a], q, rulerLen(a, {a: pend[a], b: q}));
        }
        // Rectangle being dragged with the zoom tool
        if (drag && drag.type === 'zoom' && drag.a === a) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(Math.min(drag.x0, drag.x), Math.min(drag.y0, drag.y),
                           Math.abs(drag.x - drag.x0), Math.abs(drag.y - drag.y0));
            ctx.setLineDash([]);
        }
    }
    function drawOverlays() { AX.forEach(function(a) { if (views[a]) drawOverlay(a); }); }
    function drawAll() { AX.forEach(function(a) { if (views[a]) { drawImage(a); drawOverlay(a); } }); }

    // Zoom to the dragged rectangle, widened to the aspect ratio of the view
    function zoomTo(d) {
        if (Math.abs(d.x - d.x0) < 5 || Math.abs(d.y - d.y0) < 5) return;
        const v = views[d.a], W = size[d.a][0], H = size[d.a][1], R = W / H;
        const p = toVox(d.a, Math.min(d.x0, d.x), Math.min(d.y0, d.y));
        const q = toVox(d.a, Math.max(d.x0, d.x), Math.max(d.y0, d.y));
        let w = q[0] - p[0], h = q[1] - p[1];
        if (w / h < R) w = h * R; else h = w / R;
        if (w > W) { w = W; h = w / R; }
        if (h > H) { h = H; w = h * R; }
        const cx = (p[0] + q[0]) / 2, cy = (p[1] + q[1]) / 2;
        history.push({type: 'zoom', a: d.a, win: Object.assign({}, v.win)});
        v.win = {x0: Math.max(0, Math.min(W - w, cx - w / 2)),
                 y0: Math.max(0, Math.min(H - h, cy - h / 2)), w: w, h: h};
        drawImage(d.a);
    }
    function movePan(a, dx, dy) {            // dx, dy in section voxels
        const v = views[a], w = v.win;
        w.x0 = Math.max(0, Math.min(size[a][0] - w.w, w.x0 + dx));
        w.y0 = Math.max(0, Math.min(size[a][1] - w.h, w.y0 + dy));
        drawImage(a);
        drawOverlay(a);
    }
    function panDrag(a) {                    // the image follows the pointer
        movePan(a, -(drag.x - drag.x0) / sv(a), -(drag.y - drag.y0) / sv(a));
    }
    function onClick(a, e) {
        const v = views[a], r = v.canvas.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        const [h, vv] = toVox(a, cx, cy);
        const [ha, va] = HV[a];

        if (partsOn && (mode === 'select' || mode === null)) {
            let best = -1, bd = 10;
            for (let i = 0; i < nPart; i++) {
                if (Math.abs(P[a][i] - pos[a]) > tol) continue;
                const p = toPx(a, P[ha][i] + 0.5, P[va][i] + 0.5);
                const dd = Math.hypot(p[0] - cx, p[1] - cy);
                if (dd < bd) { bd = dd; best = i; }
            }
            if (best >= 0) { selectParticle(best); return; }
        }
        if (mode === 'select') {
            const p = {};
            p[ha] = clampVox(ha, h);
            p[va] = clampVox(va, vv);
            sel = -1;
            setPos(p, true);
        } else if (mode === 'ruler') {
            if (!pend[a]) {
                pend[a] = [h, vv];
                rulers[a] = null;
            } else {
                history.push({type: 'ruler', a: a, prev: rulers[a]});
                rulers[a] = {key: keys[a][nearest(a, pos[a])], a: pend[a], b: [h, vv]};
                pend[a] = null;
            }
            updateReadout();
            drawOverlay(a);
        }
    }

    function refresh() {
        if (destroyed) return;
        AX.forEach(function(a) {
            if (!views[a]) return;
            sliders[a].$in.val(pos[a]);
            sliders[a].$lbl.text(a.toUpperCase() + ' slice: ' + pos[a]);
        });
        drawAll();
        updateReadout();
        sync3D();
    }

    /* ---------- 3D tab ---------- */
    let T = null, three = null;       // THREE module, scene state
    let built3d = false;
    let volOn = false, inverted = false, tmplOn = false;
    const VOL_OPACITY = 0.35;         // opacity of each plane of the faint volume
    let volOpacity = VOL_OPACITY;

    function reset3dView() {
        if (!three) return;
        const m = Math.max(X, Y, Z);
        three.orbit = {r: 2.3 * m};
        three.target.set(X / 2, -Y / 2, Z / 2);
        // Start from an oblique view; from here the rotation is unrestricted
        const th = 0.7, ph = 1.1, c = new T.PerspectiveCamera();
        c.position.set(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th));
        c.lookAt(0, 0, 0);
        three.quat = c.quaternion.clone();
        render3d();
    }
    function render3d() {
        if (!three || three.raf || destroyed) return;
        three.raf = requestAnimationFrame(function() {
            three.raf = 0;
            if (destroyed) return;
            const o = three.orbit, t = three.target;
            three.camera.quaternion.copy(three.quat);
            three.camera.position.copy(t).add(new T.Vector3(0, 0, o.r).applyQuaternion(three.quat));
            if (three.vol) {
                three.vol.material.uniforms.uCam.value.copy(three.vol.worldToLocal(three.camera.position.clone()));
            }
            three.renderer.render(three.scene, three.camera);
        });
    }
    function texture(a, key) {
        const id = a + ':' + key + (inverted ? ':inv' : '');
        if (three.tex[id]) return three.tex[id];
        const pid = a + ':' + key;
        const img = getImg(a, key, three.pending[pid] ? null : function() {
            three.pending[pid] = false;
            if (destroyed || !three || three.syncQueued) return;
            three.syncQueued = true;
            requestAnimationFrame(function() {
                if (three) three.syncQueued = false;
                if (!destroyed && three) sync3D();
            });
        });
        if (!img) { three.pending[pid] = true; return null; }
        let src = img;
        if (inverted) {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            g.globalCompositeOperation = 'difference';
            g.fillStyle = '#fff';
            g.fillRect(0, 0, c.width, c.height);
            src = c;
        }
        const tx = new T.Texture(src);
        tx.colorSpace = T.SRGBColorSpace;
        tx.minFilter = T.LinearFilter;
        tx.generateMipmaps = false;
        tx.needsUpdate = true;
        return (three.tex[id] = tx);
    }
    const toWorld = function(x, y, z) { return new T.Vector3(x, -y, z); };

    function sync3D() {
        if (!three) return;
        AX.forEach(function(a) {
            const i = nearest(a, pos[a]), key = keys[a][i], m = three.planes[a];
            const c = key + 0.5;
            if (a === 'z') m.position.set(X / 2, -Y / 2, c);
            else if (a === 'y') m.position.set(X / 2, -c, Z / 2);
            else m.position.set(c, -Y / 2, Z / 2);
            const tx = texture(a, key);
            if (tx || !m.material.map) m.material.map = tx;
            m.material.color.set(m.material.map ? 0xffffff : 0x444444);
            m.material.needsUpdate = true;
            m.visible = three.active.indexOf(a) >= 0;
            const $r = three.$ctrl.find('[data-axis=' + a + ']');
            $r.find('input[type=range]').val(pos[a]).prop('disabled', !m.visible);
            $r.find('input[type=checkbox]').prop('checked', m.visible);
            $r.find('.vv-lbl').text(a.toUpperCase() + ': ' + pos[a]);
        });
        three.marker.position.copy(toWorld(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5));
        if (hasParticles) {
            three.points.visible = partsOn && !tmplOn;
            if (three.tmpl) three.tmpl.visible = partsOn && tmplOn;
            three.selMark.visible = partsOn && sel >= 0;
            if (sel >= 0)
                three.selMark.position.copy(toWorld(P.x[sel] + 0.5, P.y[sel] + 0.5, P.z[sel] + 0.5));
        }
        updateVolume();
        render3d();
    }

    /* The whole tomogram as a faint ray-marched volume. The Z sections are
       packed in a 3D texture and each pixel integrates the haze along its
       line of sight, so it reads as a continuous volume, not as slices. */
    /* One instanced mesh of the template surface (Å) scaled to voxels. Each
       particle is rotated by the transpose of its RELION Euler matrix
       (rot, tilt, psi), in the viewer's world (y is flipped). */
    function buildTemplate(scene) {
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.BufferAttribute(new Float32Array(tmplData.vertices), 3));
        g.setIndex(tmplData.faces);
        g.computeVertexNormals();
        const mat = new T.MeshLambertMaterial({color: 0x4dabf7, side: T.DoubleSide});
        const mesh = new T.InstancedMesh(g, mat, nPart);
        const k = 1 / vs.x, sg = [1, -1, 1], d2r = Math.PI / 180;
        const m4 = new T.Matrix4();
        for (let i = 0; i < nPart; i++) {
            const ang = P.angles && P.angles[i] ? P.angles[i] : [0, 0, 0];
            const cr = Math.cos(ang[0] * d2r), sr = Math.sin(ang[0] * d2r);
            const ct = Math.cos(ang[1] * d2r), st = Math.sin(ang[1] * d2r);
            const cp = Math.cos(ang[2] * d2r), sp = Math.sin(ang[2] * d2r);
            const A = [[cp * ct * cr - sp * sr, cp * ct * sr + sp * cr, -cp * st],
                       [-sp * ct * cr - cp * sr, -sp * ct * sr + cp * cr, sp * st],
                       [st * cr, st * sr, ct]];
            const e = [];
            for (let r = 0; r < 3; r++) {
                for (let c = 0; c < 3; c++) e.push(sg[r] * sg[c] * A[c][r] * k);
            }
            const w = toWorld(P.x[i] + 0.5, P.y[i] + 0.5, P.z[i] + 0.5);
            m4.set(e[0], e[1], e[2], w.x,
                   e[3], e[4], e[5], w.y,
                   e[6], e[7], e[8], w.z,
                   0, 0, 0, 1);
            mesh.setMatrixAt(i, m4);
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.visible = false;
        mesh.frustumCulled = false;
        scene.add(mesh);
        scene.add(new T.AmbientLight(0xffffff, 0.7));
        const sun = new T.DirectionalLight(0xffffff, 0.8);
        sun.position.set(1, 1, 2);
        scene.add(sun);
        three.tmpl = mesh;
    }
    function buildVolume() {
        if (three.vol || three.volLoading) return;
        const zk = keys.z;
        const imgs = zk.map(function(k) { return getImg('z', k, null); });
        if (imgs.some(function(i) { return !i; })) {
            // wait once for the slow images, then build
            three.volLoading = true;
            let left = 0;
            zk.forEach(function(k, i) {
                if (imgs[i]) return;
                left++;
                getImg('z', k, function() {
                    if (--left === 0) {
                        three.volLoading = false;
                        if (!destroyed && three) updateVolume();
                    }
                });
            });
            return;
        }
        const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight, d = zk.length;
        const data = new Uint8Array(w * h * d);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d', {willReadFrequently: true});
        imgs.forEach(function(im, i) {
            g.drawImage(im, 0, 0, w, h);
            const px = g.getImageData(0, 0, w, h).data;
            for (let j = 0; j < w * h; j++) data[i * w * h + j] = px[4 * j];
        });
        const tex = new T.Data3DTexture(data, w, h, d);
        tex.format = T.RedFormat;
        tex.type = T.UnsignedByteType;
        tex.minFilter = tex.magFilter = T.LinearFilter;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        const mat = new T.ShaderMaterial({
            transparent: true, depthWrite: false, side: T.FrontSide,
            uniforms: {uTex: {value: tex}, uCam: {value: new T.Vector3()}, uSize: {value: new T.Vector3(X, Y, Z)},
                       uOp: {value: volOpacity}, uInv: {value: 0}},
            vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: [
                'precision highp float; precision highp sampler3D;',
                'uniform sampler3D uTex; uniform vec3 uCam, uSize; uniform float uOp, uInv; varying vec3 vP;',
                'void main() {',
                '  vec3 dir = normalize(vP - uCam);',
                '  vec3 hs = uSize * 0.5, inv = 1.0 / dir;',
                '  vec3 t1 = (-hs - vP) * inv, t2 = (hs - vP) * inv;',
                '  float tmax = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));',
                '  const int N = 64;',
                '  float dt = tmax / float(N);',
                '  vec3 col = vec3(0.0); float a = 0.0;',
                '  for (int i = 0; i < N; i++) {',
                '    vec3 p = vP + dir * (float(i) + 0.5) * dt;',
                '    vec3 uv = vec3(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y, p.z / uSize.z + 0.5);',
                '    float v = texture(uTex, uv).r;',
                '    v = mix(v, 1.0 - v, uInv);',
                '    float s = uOp * (dt / uSize.z) * 6.0 * (0.25 + abs(v - 0.5) * 3.0);',
                '    s = clamp(s, 0.0, 1.0);',
                '    col += (1.0 - a) * s * vec3(v);',
                '    a += (1.0 - a) * s;',
                '    if (a > 0.98) break;',
                '  }',
                '  gl_FragColor = vec4(col / max(a, 0.001), a);',
                '}'].join('\n')
        });
        const m = new T.Mesh(new T.BoxGeometry(X, Y, Z), mat);
        m.position.set(X / 2, -Y / 2, Z / 2);
        m.renderOrder = 0;
        m.frustumCulled = false;
        three.scene.add(m);
        three.vol = m;
    }
    function updateVolume() {
        if (!three) return;
        if (volOn) buildVolume();
        if (three.vol) {
            three.vol.visible = volOn;
            three.vol.material.uniforms.uOp.value = volOpacity;
            three.vol.material.uniforms.uInv.value = inverted ? 1 : 0;
        }
        three.$ctrl.find('.vv-volrow').toggle(volOn);
        render3d();
    }
    function toggleVolume() {
        volOn = !volOn;
        syncToolbars();
        sync3D();
    }
    function toggleInvert(isUndo) {
        if (!isUndo) history.push({type: 'invert'});
        inverted = !inverted;
        AX.forEach(function(a) { if (views[a]) views[a].$el.find('canvas.vv-img').css('filter', inverted ? 'invert(1)' : ''); });
        syncToolbars();
        sync3D();
    }
    function onClick3d(e) {
        const el = three.renderer.domElement, rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        const ndc = new T.Vector2(px / rect.width * 2 - 1, -(py / rect.height * 2 - 1));
        three.camera.updateMatrixWorld();

        if (mode !== 'select' && mode !== null) return;
        if (partsOn) {
            let best = -1, bd = 10;
            const v = new T.Vector3();
            for (let i = 0; i < nPart; i++) {
                v.copy(toWorld(P.x[i] + 0.5, P.y[i] + 0.5, P.z[i] + 0.5)).project(three.camera);
                if (v.z > 1) continue;
                const dd = Math.hypot((v.x + 1) / 2 * rect.width - px, (1 - v.y) / 2 * rect.height - py);
                if (dd < bd) { bd = dd; best = i; }
            }
            if (best >= 0) { selectParticle(best); return; }
        }
        if (mode !== 'select') return;
        three.ray.setFromCamera(ndc, three.camera);
        const hits = three.ray.intersectObjects(AX.map(function(a) { return three.planes[a]; })
                                                  .filter(function(m) { return m.visible; }));
        if (!hits.length) return;
        const p = hits[0].point;
        sel = -1;
        setPos({x: clampVox('x', p.x), y: clampVox('y', -p.y), z: clampVox('z', p.z)}, true);
    }

    function setupControls(el) {
        let drag = null;
        el.addEventListener('contextmenu', function(e) { e.preventDefault(); });
        el.addEventListener('pointerdown', function(e) {
            el.setPointerCapture(e.pointerId);
            drag = {x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: 0};
            el.style.cursor = 'grabbing';
        });
        el.addEventListener('pointermove', function(e) {
            if (!drag) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            drag.x = e.clientX; drag.y = e.clientY;
            drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
            const o = three.orbit;
            if (e.buttons & 2 || e.shiftKey || mode === 'pan') {
                // Pan along the camera plane
                const k = o.r * 0.0015, cam = three.camera;
                const right = new T.Vector3(1, 0, 0).applyQuaternion(three.quat);
                const up = new T.Vector3(0, 1, 0).applyQuaternion(three.quat);
                three.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
            } else {
                // Free trackball rotation around the camera axes, with no limits
                const cam = three.quat;
                const up = new T.Vector3(0, 1, 0).applyQuaternion(cam);
                const right = new T.Vector3(1, 0, 0).applyQuaternion(cam);
                const q = new T.Quaternion().setFromAxisAngle(up, -dx * 0.008)
                    .multiply(new T.Quaternion().setFromAxisAngle(right, -dy * 0.008));
                three.quat.premultiply(q).normalize();
            }
            render3d();
        });
        el.addEventListener('pointerup', function(e) {
            el.style.cursor = 'grab';
            const was = drag;
            drag = null;
            if (was && was.moved < 4 && e.button === 0) onClick3d(e);
        });
        el.addEventListener('wheel', function(e) {
            e.preventDefault();
            three.orbit.r = Math.max(10, Math.min(50 * Math.max(X, Y, Z), three.orbit.r * Math.exp(e.deltaY * 0.001)));
            render3d();
        }, {passive: false});
    }

    async function build3d() {
        built3d = true;
        $p3.empty().append('<div class="vv-msg">Loading 3D view…</div>');
        const url = config.threeUrl || THREE_URL;
        try {
            T = await import(url);
        } catch (e) {
            console.error('three.js could not be loaded', e);
            $p3.empty().append('<div class="vv-msg">The 3D view could not be loaded.</div>');
            return;
        }
        if (destroyed) return;
        let renderer;
        try {
            renderer = new T.WebGLRenderer({antialias: true});
        } catch (e) {
            $p3.empty().append('<div class="vv-msg">WebGL is not available in this browser.</div>');
            return;
        }
        const fit = fit3d(), W3 = config.view3dWidth || fit[0], H3 = config.view3dHeight || fit[1];
        renderer.setPixelRatio(dpr);
        renderer.setSize(W3, H3);
        renderer.setClearColor(0x111418);
        const scene = new T.Scene();
        const camera = new T.PerspectiveCamera(40, W3 / H3, 1, 100 * Math.max(X, Y, Z));
        three = {renderer: renderer, scene: scene, camera: camera, tex: {}, pending: {}, planes: {}, raf: 0,
                 target: new T.Vector3(X / 2, -Y / 2, Z / 2), orbit: null, active: ['z', 'y'],
                 ray: new T.Raycaster()};

        const geo = {z: new T.PlaneGeometry(X, Y), y: new T.PlaneGeometry(X, Z), x: new T.PlaneGeometry(Z, Y)};
        AX.forEach(function(a) {
            // Planes are drawn after the faint volume so the haze never dims them
            const m = new T.Mesh(geo[a], new T.MeshBasicMaterial({side: T.DoubleSide, transparent: true, opacity: 1}));
            m.renderOrder = 1;
            if (a === 'y') m.rotation.x = -Math.PI / 2;
            if (a === 'x') m.rotation.y = -Math.PI / 2;
            three.planes[a] = m;
            scene.add(m);
        });
        const box = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(X, Y, Z)),
                                       new T.LineBasicMaterial({color: 0x8a94a0}));
        box.position.set(X / 2, -Y / 2, Z / 2);
        scene.add(box);

        const m = Math.max(X, Y, Z);
        three.marker = new T.Mesh(new T.SphereGeometry(m / 120, 12, 12),
                                  new T.MeshBasicMaterial({color: 0x339af0}));
        scene.add(three.marker);
        if (hasParticles) {
            const arr = new Float32Array(nPart * 3);
            for (let i = 0; i < nPart; i++) {
                arr[3 * i] = P.x[i] + 0.5; arr[3 * i + 1] = -(P.y[i] + 0.5); arr[3 * i + 2] = P.z[i] + 0.5;
            }
            const pg = new T.BufferGeometry();
            pg.setAttribute('position', new T.BufferAttribute(arr, 3));
            three.points = new T.Points(pg, new T.PointsMaterial({color: 0xffa500, size: 3.5, sizeAttenuation: false}));
            scene.add(three.points);
            if (tmplData && vs) buildTemplate(scene);
            three.selMark = new T.Mesh(new T.SphereGeometry(m / 70, 12, 12),
                                       new T.MeshBasicMaterial({color: 0xff3b30}));
            three.selMark.visible = false;
            scene.add(three.selMark);
        }

        // Controls: one slider per plane, only two planes active at a time
        const $ctrl = three.$ctrl = $('<div class="vv-3d-ctrl"></div>');
        $ctrl.append('<div class="vv-row text-muted" title="Drag to rotate in any direction, right-drag or shift+drag to move, wheel to zoom">' +
                     'Up to two planes at a time</div>');
        AX.forEach(function(a) {
            $ctrl.append('<div class="vv-row" data-axis="' + a + '"><label style="margin:0"><input type="checkbox"> ' +
                         a.toUpperCase() + ' plane</label>' +
                         '<input type="range" min="0" step="1" max="' + (dim[a] - 1) + '" style="width:100%">' +
                         '<div class="vv-lbl text-right"></div></div>');
        });
        $ctrl.append('<div class="vv-row vv-volrow" style="display:none">Volume opacity' +
                     '<input type="range" class="vv-op" min="5" max="100" value="' + Math.round(volOpacity * 100) +
                     '" style="width:100%"></div>');
        $ctrl.on('input', '.vv-op', function() {
            volOpacity = Number($(this).val()) / 100;
            updateVolume();
            render3d();
        });
        $ctrl.on('change', 'input[type=checkbox]', function() {
            const a = $(this).closest('[data-axis]').attr('data-axis');
            const i = three.active.indexOf(a);
            if (i >= 0) three.active.splice(i, 1);
            else {
                three.active.push(a);
                if (three.active.length > 2) three.active.shift();
            }
            if (three.active.length === 0) three.active.push(a);
            sync3D();
        });
        $ctrl.on('input', '[data-axis] input[type=range]', function() {
            const a = $(this).closest('[data-axis]').attr('data-axis');
            pos[a] = Number($(this).val());
            refresh();
            emit();
        });

        $p3.empty().append($tb.view3d);
        const $wrap = $('<div class="vv-3d-wrap"></div>').appendTo($p3);
        $('<div class="vv-3d-canvas"></div>').append(renderer.domElement).appendTo($wrap);
        $wrap.append($ctrl);
        setupControls(renderer.domElement);
        syncToolbars();
        reset3dView();
        sync3D();
        updateReadout();
    }

    /* ---------- size and full screen ---------- */
    function relayout() {
        if (destroyed) return;
        s = fitScale();
        AX.forEach(function(a) {
            const v = views[a];
            if (!v) return;
            v.cw = size[a][0] * s; v.ch = size[a][1] * s;
            ['img', 'ov'].forEach(function(n) {
                const c = v.$el.find('canvas.vv-' + n)[0];
                c.width = Math.round(v.cw * dpr); c.height = Math.round(v.ch * dpr);
                c.style.width = v.cw + 'px'; c.style.height = v.ch + 'px';
                v[n].setTransform(dpr, 0, 0, dpr, 0, 0);
            });
            v.$el.find('figure').css({width: v.cw, height: v.ch});
            v.drawn = null;
            sliders[a].$in.css('width', Math.max(size[a === 'x' ? 'x' : 'z'][0] * s, 110));
        });
        if (three) {
            const f = fit3d();
            three.renderer.setSize(f[0], f[1]);
            three.camera.aspect = f[0] / f[1];
            three.camera.updateProjectionMatrix();
            render3d();
        }
        if ($slices.is(':visible')) drawAll();
    }
    function setFull(on) {
        full = on;
        $fullBtn.attr('title', on ? 'Exit full screen' : 'Full screen')
            .find('i').toggleClass('fa-expand', !on).toggleClass('fa-compress', on);
        relayout();
    }
    $fullBtn.on('click', function() {
        const el = $root[0];
        if (el.requestFullscreen) {
            if (document.fullscreenElement === el) document.exitFullscreen();
            else el.requestFullscreen().catch(function() { $root.addClass('vv-fixed'); setFull(true); });
        } else {
            $root.toggleClass('vv-fixed');
            setFull($root.hasClass('vv-fixed'));
        }
    });
    $(document).on('fullscreenchange.' + prefix, function() {
        if (document.fullscreenElement === $root[0]) setFull(true);
        else if (full && !$root.hasClass('vv-fixed')) setFull(false);
    });
    $(document).on('keydown.' + prefix, function(e) {
        if (e.key === 'Escape' && $root.hasClass('vv-fixed')) { $root.removeClass('vv-fixed'); setFull(false); }
    });

    /* ---------- tabs ---------- */
    function showTab(name) {
        $tabs.find('button').removeClass('active').filter('[data-tab=' + name + ']').addClass('active');
        $slices.toggle(name === 'slices');
        $p3.toggle(name === 'view3d');
        if (name === 'view3d') {
            if (!built3d) build3d();
            else sync3D();
        } else {
            drawAll();
        }
    }
    $tabs.on('click', 'button', function() { showTab($(this).attr('data-tab')); });

    if (tabsCfg.slices) buildSlices();
    syncToolbars();
    showTab(tabsCfg.slices ? 'slices' : 'view3d');
    refresh();

    return {
        destroy: function() {
            destroyed = true;
            $(document).off('.' + prefix);
            $(window).off('.' + prefix);
            if (document.fullscreenElement === $root[0]) document.exitFullscreen();
            if (three) {
                cancelAnimationFrame(three.raf);
                Object.keys(three.tex).forEach(function(k) { if (three.tex[k]) three.tex[k].dispose(); });
                three.renderer.dispose();
            }
            three = null;
            $root.remove();
        },
        getPosition: function() { return {x: pos.x, y: pos.y, z: pos.z}; },
        setPosition: function(p) { setPos(p, false); },
        setTool: setTool
    };
}

window.createVolumeViewer = createVolumeViewer;
})();
