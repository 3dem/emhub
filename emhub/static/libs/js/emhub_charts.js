/**
 * Created by J.M. de la Rosa on 05/01/2022
 */


function create_hc_polar(charDivId, data, label, config){

    return new Highcharts.Chart({
        colors: [config.color],
        chart: {
            renderTo: charDivId,
            polar: true,
            margin: [0, 0, 0, 0],
            spacing: [0, 0, 0, 0],
            height: '70%',

            //type: 'scatter'
        },
        pane: {
            size: '70%',
        },
        exporting: {enabled: false},
        legend: {enabled: false},
        title: undefined,
        plotOptions: {
            series: {
                marker: {
                    radius: 2
                }
            }
        },
        subtitle: {
            align: 'left',
            text: label,
            x: 10,
        },
        xAxis: {
            tickInterval: 45,
            min: 0,
            max: 360,
            labels: {format: '{value}°'}
        },
         yAxis: {
            tickInterval: config.maxY/3,
            min: 0,
            max: config.maxY,
            labels: {format: '{value:.2f}'},
             opposite: true,
        },
        credits: {enabled: false},
        series: [{
            name: 'Points',
            data: data,
            type: 'scatter',
            groupPadding: 0,
            pointPadding: 0,
            pointPlacement: 'between'
        }]
    });
}

function create_hc_series(container, data, config) {
    function get_micIndex(x) {
        for (var i = 0; i < data.length - 1; ++i) {
            if (x >= data[i][0] && x <= data[i+1][0])
               return x - data[i][0] < data[i+1][0] - x ? i : i + 1;
        }
        return -1;
    }

    var mylabel = config.label;
    var mysuffix = config.suffix;

    // Create the chart
    return Highcharts.stockChart(container, {
        plotOptions: {
                // series: {
                //     turboThreshold: 0,
                // }
            },
        tooltip: {
                formatter: function() {
                    var micIndex = get_micIndex(this.x);
                    var tooltip = '';
                    if (micIndex > 0) {
                        tooltip = '<span>' + session_data.gridsquares[micIndex] + '</span><br/><br/>' +
                            '<b>Micrograph ' + (micIndex+1) + '</b><br/>' +
                            mylabel + ": " + data[micIndex][1].toFixed(2) + " " + mysuffix + '<br/>';
                    }
                    return tooltip;
                  }
            },
        colors: [config.color],
        chart: {
            events: {
                load: function () {
                }
            },
            zoomType: 'x',
        },
        rangeSelector: {
            buttons: [{
                type: 'hour',
                count: 1,
                text: '1h'
            }, {
                type: 'hour',
                count: 3,
                text: '3h'
            }, {
                type: 'hour',
                count: 6,
                text: '6h'
            }, {
                type: 'all',
                text: 'All'
            }],
            selected: 1,
            inputEnabled: false
        },
        xAxis: {
          plotLines: config.gsLines,
        },
        yAxis: {
            title: {
                text: config.label + " (" + config.suffix + ")",
            },
            opposite: false,
            min: config.minY,
            max: config.maxY,
            startOnTick: false,
            endOnTick: false
        },

        exporting: {enabled: false},
        legend: {enabled: false},
        title: undefined,
        series: [{
            name: config.label,
            id: "datapoints",
            data: data,
            point: {
                events: {
                    click: function () {
                        var micIndex = get_micIndex(this.x);
                        if (micIndex > 0)
                            mic_card.loadMicData(micIndex + 1);
                    }
                }
            }

        }]
    });
} // function create_hc_series


function create_hc_defocus_series(containerId, data) {
    var config = {
        color: '#852999',
        label: 'Defocus',
        suffix: 'µm',
        minY: data.min * 0.9,
        maxY: data.max * 1.1, //Math.max(...data),
        gsLines: data.lines
    }
    return create_hc_series(containerId, data.points, config);
}


function create_hc_resolution_series(containerId, data) {
    var config = {
        color: '#EF9A53',
        label: 'Resolution',
        suffix: 'Å',
        minY: data.min * 0.9,
        maxY: data.max * 1.1,
        gsLines: data.lines
    }
    return create_hc_series(containerId, data.points, config);
}


function create_hc_defocus_histogram(containerId, data, percent) {
    const maxD = Math.max(...data);
    var config = {
        color: '#852999',
        label: 'Defocus',
        suffix: 'µm',
        maxX: Math.min(maxD, 4),
        binsNumber: 10,
        percent: percent
    }
    return create_hc_histogram(containerId, data, config);
}


function create_hc_resolution_histogram(containerId, data, percent) {
    const maxD = Math.max(...data);
    var config = {
        color: '#EF9A53',
        label: 'Resolution',
        suffix: 'Å',
        maxX: Math.min(maxD, 10),
        binsNumber: 20,
        percent: percent
    }
    return create_hc_histogram(containerId, data, config);
}


function create_hc_histogram(containerId, data, config) {
    var chart = Highcharts.chart(containerId, {
        chart: {
            height: config.percent + '%'
        },
        margin: [0, 0, 0, 0],
        spacing: [0, 0, 0, 0],
        exporting: {enabled: false},
        legend: {enabled: false},
        colors: [config.color],
        credits: {enabled: false},
      title: {
        text: ''
      },
      xAxis: [{
        title: {
          text: ''
        },
        alignTicks: false,
        opposite: false,
          max: 4
      }, {
        title: {
          text: config.label + ' (' + config.suffix + ')'
        },
        alignTicks: true,
        opposite: false,
          max: config.maxX
      }],
      yAxis: [
        {
            title: {text: ''}
        },
        {
        title: {
          text: 'Micrographs'
        },
        opposite: false,
        }],
      plotOptions: {
        histogram: {
          binsNumber: config.binsNumber
        }
      },
      series: [{
        name: config.label,
        type: 'histogram',
        xAxis: 1,
        yAxis: 1,
        baseSeries: 's1',
        zIndex: -1
      }, {
        name: '',
        type: 'scatter',
        data: data,
        visible: false,
        id: 's1',
        marker: {
          radius: 1.5
        }
      }]
    });
}


function create_hc_files_pie(containerId, filesData) {
    Highcharts.chart(containerId, {
    chart: {
        type: 'variablepie'
    },
    title: {
        text: 'Files count and size by extension'
    },
    tooltip: {
        headerFormat: '',
        pointFormat: '<span style="color:{point.color}">\u25CF</span> <b> {point.name}</b><br/>' +
            'Count: <b>{point.y}</b><br/>' +
            'Size: <b>{point.sizeH}</b><br/>'
    },
    series: [{
        minPointSize: 10,
        innerSize: '20%',
        zMin: 0,
        name: 'files',
        data: filesData

    }]
});
}


function create_hc_usage(containerId, chartType, usageData, drilldownData, args){
    // Create the chart
    var title = getObjectValue(args, 'title', '');
    var subtitle = getObjectValue(args, 'subtitle', '');

    Highcharts.chart(containerId, {
    chart: {
        type: chartType,
    },
    title: {
        text: title,
        align: 'left'
    },
    subtitle: {
        text: subtitle,
        align: 'left'
    },

    accessibility: {
        announceNewData: {
            enabled: true
        },
        point: {
            valueSuffix: '%'
        }
    },

    plotOptions: {
        series: {
            dataLabels: {
                enabled: true,
                format: '{point.name}: {point.y:.1f}%'
            }
        }
    },

    tooltip: {
        headerFormat: '<span style="font-size:11px">{series.name}</span><br>',
        pointFormat: '<span style="color:{point.color}">{point.name}</span>: <b>{point.y:.2f}%</b> of total<br/>'
    },

    series: [
        {
            name: 'Usage',
            colorByPoint: true,
            data: usageData
        }
    ],
    drilldown: {
        series: drilldownData
    }
});
}


function create_hc_hourly(containerId, data, title, subtitle){
    var categories = [];
    for (var i = 0; i < data.length; ++i)
        categories.push('+' + (i+1));

    return Highcharts.chart(containerId, {
    chart: {
        type: 'column',

    },
    title: {
        text: title
    },
    subtitle: {
        text: subtitle
    },
    xAxis: {
        categories: categories,
     crosshair: false
    },
    yAxis: {
        min: 0,
        title: {
            text: 'Number of images'
        }
    },
    tooltip: {
        headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
        pointFormat: '<tr><td style="padding:0"><b>{point.y:.1f} images</b></td></tr>',
        footerFormat: '</table>',
        shared: true,
        useHTML: true
    },
    plotOptions: {
        column: {
            pointPadding: 0.0,
            borderWidth: 0
        }
    },
    series: [{
        data: data
    }]
});
}  // function create_hc_hourly


/* Draw the micrograph images with coordinates(optional) */
function drawMicrograph(containerId, micrograph, drawCoordinates) {
    var canvas = document.getElementById(containerId);
    var ctx = canvas.getContext("2d");

    var image = new Image();

    image.onload = function() {
        if (canvas.height != image.height) {
            canvas.height = image.height;
            canvas.width = image.width;
            canvas_ratio = canvas.width / parseFloat(canvas.height);
        }

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        if (!drawCoordinates || micrograph.coordinates.length == 0)
            return;

        ctx.fillStyle = '#00ff00';

        var scale = parseFloat(micrograph.pixelSize) / micrograph.thumbnailPixelSize;
        var coords = micrograph.coordinates;

        for (var i = 0; i < coords.length; ++i){
            var x = Math.round(coords[i][0] * scale);
            var y = Math.round(coords[i][1] * scale);
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        }
    };

    image.src = 'data:image/png;base64,' + micrograph.thumbnail;
}

function drawClasses2d(containerId, classes, header, showSel){
    var container = document.getElementById(containerId);
    var imgStr, infoStr = null;
    html = '<div class="col-12">' + header + '</div>';

    for (var cls2d of classes) {
        let borderColor = showSel && cls2d.sel ? 'limegreen' : 'white';
        imgStr = '<img src="data:image/png;base64,' + cls2d.average + '" style="border: solid 3px ' + borderColor + ';">';
        infoStr = '<p class="text-muted mb-0"><small>size: ' + cls2d.size + ', id: ' + cls2d.id + '</small></p>';
        html += '<div style="padding: 3px; min-width: 90px;">' + imgStr + infoStr + '</div>';

    }
    container.innerHTML = html;
}

class Overlay {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.text_div = document.getElementById(containerId + '_text');
    }

    show(msg) {
        this.text_div.innerHTML = msg;
        this.container.style.display = "flex";
    }

    hide(){
        this.container.style.display = "none";
    }
}


class MicrographCard {
    constructor(containerId, gsCard) {
        this.containerId = containerId;
        this.overlay = new Overlay(this.id('overlay'));
        this.gsCard = gsCard;
        let self = this;

        // Bind enter key with micrograph number input
        $(self.jid('mic_id')).on('keyup', function (e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                self.loadMicData($(self.jid('mic_id')).val());
            }
        });

        // Bind to on/off coordinates display
        $(self.jid('show_particles')).change(function() {
            self.drawMicrograph();
        });
    }

    id(suffix) {
        return this.containerId + '_' + suffix;
    }

    jid(suffix) {
        return '#' + this.id(suffix)
    }

    drawMicrograph() {
       drawMicrograph(this.id('mic_canvas'), this.micrograph,
           $(this.jid('show_particles')).prop('checked'));
    }

    loadMicData(micId, doneCallback) {
        let self = this;
        let t = new Timer()

        $(this.jid('mic_id')).val(micId);

        this.overlay.show("Loading Micrograph " + micId + " ...");

        var requestMicThumb = $.ajax({
            url: urls.get_mic_data,
            type: "POST",
            data: {micId : micId, sessionId: session_id},
            dataType: "json"
           // contentType: "img/png"
        });

        requestMicThumb.done(function(data) {
            micrograph = {
                thumbnail: data['micThumbData'],
                coordinates: data['coordinates'],
                pixelSize: data['pixelSize'],
                thumbnailPixelSize: data['micThumbPixelSize']
            };
            self.micrograph = micrograph;

            self.drawMicrograph()

            if (nonEmpty(self.gsCard)) {
                self.gsCard.loadData(data.gridSquare);
            }

            $(self.jid('img_psd')).attr('src', 'data:image/png;base64,' + data.psdData);
            function setLabel(containerId, value){
                var elem = document.getElementById(containerId);
                var parts = elem.innerHTML.split(":");
                elem.innerHTML = parts[0] + ": " + value;
            }

            let compact = $(self.jid('compact')).val();

            if (compact === 'False') {
                $(self.jid('mic_defocus_u')).text(data['ctfDefocusU']);
                $(self.jid('mic_defocus_v')).text(data['ctfDefocusV']);
                $(self.jid('mic_defocus_angle')).text(data['ctfDefocusAngle']);
                $(self.jid('mic_astigmatism')).text(data['ctfAstigmatism']);
            }
            else {
                let uva = data['ctfDefocusU'] + ', ' + data['ctfDefocusV'] + ', ' + data['ctfDefocusAngle'];
                $(self.jid('mic_defocus_uva')).text(uva);
            }

            $(self.jid('mic_resolution')).text(data['ctfResolution']);
            $(self.jid('particles')).text(micrograph.coordinates.length);

            self.overlay.hide();

             //$(self.jid('testing')).text(compact);

            if (doneCallback)
                doneCallback();
        });

        requestMicThumb.fail(function(jqXHR, textStatus) {
          alert( "Request failed: " + textStatus );
        });
    }
}


class GridSquareCard {
    constructor(containerId) {
        this.containerId = containerId;
        this.overlay = new Overlay(this.id('overlay'));
        this.last = null;
    }

    id(suffix) {
        return this.containerId + '_' + suffix;
    }

    jid(suffix) {
        return '#' + this.id(suffix)
    }

    loadData(gridSquare) {
        // Do not load if it is the same GridSquare
        if (gridSquare == this.last)
            return;

        let self = this;
        var attrs = {sessionId: session_id, gsId: gridSquare};
        this.last = gridSquare;
        this.overlay.show('Loading ' + gridSquare);

        var requestMicImg = $.ajax({
            url: urls.get_micrograph_gridsquare,
            type: "POST",
            data: attrs,
            dataType: "json"
        });

        requestMicImg.done(function(data) {
            if (data.gridSquare.thumbnail) {
                $(self.jid('name')).text(gridSquare);
                $(self.jid('micrographs')).text(data.defocus.length);
                $(self.jid('particles')).text(data.particles);
                $(self.jid('image')).attr('src', 'data:image/png;base64,' + data.gridSquare.thumbnail);
                create_hc_defocus_histogram(self.id('defocus_hist'), data.defocus, 80);
                create_hc_resolution_histogram(self.id('resolution_hist'), data.resolution, 80);
            }
            self.overlay.hide();
        });

        requestMicImg.fail(function(jqXHR, textStatus) {
          alert("GridSquare request failed: " + textStatus );
          self.overlay.hide();
        });
    }

}  // class GridSquareCard

/* --------------------------- Session Live functions ------------------------*/
function session_getData2D(run_id){
    overlay_2d.show("Loading Class2D, run " + run_id);
    return session_getData({result: 'classes2d', run_id: run_id})
}

function session_getData(attrs) {
    // Update template values
    attrs.session_id = session_id;
    var ajaxContent = $.ajax({
        url: urls.get_session_data,
        type: "POST",
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify({attrs: attrs}),
        dataType: "json"
    });

    ajaxContent.done(
        function (jsonResponse) {
            var error = null;

            if ('error' in jsonResponse) {
                error = jsonResponse.error;
            }
            else {
                let classes2d = jsonResponse.classes2d;

                if (nonEmpty(classes2d)) {
                    let items = classes2d.items;
                    let n = items.length;
                    let sel = classes2d.selection;
                    let nsel = sel.length;
                    var total = 0;
                    var totalSel = 0;
                    var itemsSel = [];

                    for (var i = 0; i < n; ++i) {
                        cls = items[i];
                        total += cls.size;
                        if (sel.indexOf(parseInt(cls.id)) >= 0) {
                            cls.sel = true;
                            totalSel += cls.size;
                            itemsSel.push(cls);
                        }
                        else
                            cls.sel = false;
                    }
                    classes2d_container = document.getElementById('classes2d_container');

                    let col =  nsel ? '7' : '12';
                    classes2d_container.innerHTML = '<div id="classes2d_all" class="row col-' + col + '" style="vertical-align: top;"></div>';

                    if (nsel) {
                        classes2d_container.innerHTML += '<div id="classes2d_sel" class="row col-4 align-content-start ml-5"></div>'

                        let cPercent = (nsel * 100 / n).toFixed(0);
                        let pPercent = (totalSel * 100 / total).toFixed(0);
                        let selHeader = '<label>Selection</label>: <strong>' + nsel + '</strong> classes (' + cPercent + '%) from <strong>' + totalSel + '</strong> particles (' + pPercent + '%)';
                        drawClasses2d('classes2d_sel', itemsSel, selHeader);
                    }

                    let header = '<label>All</label>: <strong>' + n + '</strong> classes from <strong>' + total + '</strong> particles';
                    drawClasses2d('classes2d_all', items, header, true);

                    $('#selectpicker-classes2d').find('option').remove();

                    let nRuns = classes2d.runs.length;
                    for (var i = 0; i < nRuns; ++i) {
                        let run = classes2d.runs[i];
                        //let selected = attrs.run_id == run.id ? 'selected' : '';
                        let optStr = '<option value="' + run.id + '">' + run.label + '</option>';
                        $('#selectpicker-classes2d').append(optStr);
                    }
                    let selectedValue = classes2d.runs[attrs.run_id].id.toString();
                    $('#selectpicker-classes2d').selectpicker('refresh');
                    $('#selectpicker-classes2d').val(selectedValue);
                    $('#selectpicker-classes2d').selectpicker('refresh');

                    overlay_2d.hide();
                }
                else if ('defocus' in jsonResponse) {
                    var count = session_data == null ? 0 : session_data.resolution.length;
                    session_data = jsonResponse;
                    // TODO: Update Defocus plot with new values since last time
                    var new_count = session_data.resolution.length;
                    if (new_count > count) {
                        session_updatePlots();
                        mic_card.loadMicData(new_count);
                    }

                    if (session_data.session.status != "finished") {
                        setTimeout(session_reload, 60000);
                    }
                }
            }
        }
    );
    ajaxContent.fail(function(jqXHR, textStatus) {
      alert(" Request failed: " + textStatus );
    });
}  // function session_getData


function session_reload() {
    session_getData({result: 'micrographs'});
}


function session_resize(){

    ctfPlots = document.getElementById('ctf_plots');
    imgPlots = document.getElementById('image_plots');

    if (ctfPlots != null && imgPlots != null) {
        const width  = window.innerWidth || document.documentElement.clientWidth ||
        document.body.clientWidth;
        const height = window.innerHeight || document.documentElement.clientHeight ||
        document.body.clientHeight;
        ctfPlots.className = width < 2000 ? 'col-8' : 'col-5';
        imgPlots.className = width < 2000 ? 'col-12' : 'col-5';
    }

    //var canvas = document.getElementById("canvas_micrograph");
    var w = $("#canvas_micrograph").width();
    var h = Math.round(w / canvas_ratio);
    $("#canvas_micrograph").height(h);
}


function session_setCounter(container, value){
    let strValue = nonEmpty(value) ? value.toString() : '';
    document.getElementById(container).innerHTML = strValue;
}

function session_updateCounters(){
    let stats = session_data.stats;
    let nMovies = stats.movies.count;
    let nCtfs = stats.ctfs.count;

    session_timespan.first = stats.movies.first * 1000;
    session_timespan.step = (stats.movies.last - stats.movies.first) * 1000 / nMovies;

    session_setCounter('counter_imported', nMovies);
    //setCounter('counter_aligned', stats['numOfMics']);
    session_setCounter('ctf_count', nCtfs);

    // Picked particle coordinates
    session_setCounter('counter_picked', stats.coordinates.count);
    session_setCounter('diff_picked', Math.round(stats.coordinates.count/nCtfs) + " / mic");

    session_setCounter('ctf_diff', nCtfs - nMovies);
    session_setCounter('ctf_speed', " " + Math.round(nCtfs/stats.ctfs.hours) + " / h");
    //setCounter('diff_ctf', stats['numOfCtfs'] - stats['numOfMics']);
    session_setCounter('imported_tag', " " + Math.round(nMovies/stats.movies.hours) + " / h");

    let extra = session_data.session.extra;
    let otf = extra.otf;
    if (otf.processes)
        session_setCounter('label_processes', otf.processes.length);
    session_setCounter('label_updated', extra.updated);
}

function session_updatePlots() {

    session_updateCounters();

    if (session_plots == null)  // Create new plots
    {
        var config = {
            color: '#852999',
            label: 'Defocus',
            suffix: 'µm',
            maxY: 0.0,
            startX: session_timespan.first,
            stepX: session_timespan.step
        }

        var data = [];
        session_plots = {};
        var data_defocus = [];
        var data_resolution = [];
        var ts = config.startX;
        var date, gs;

        gsLines = [];

        var lastGs = null;
        for (var i = 0; i < session_data.defocusAngle.length; ++i) {

            var angle = session_data.defocusAngle[i];
            if (angle < 0)
                angle = 360 + angle;
            const a = session_data.astigmatism[i];
            if (a > config.maxY)
                config.maxY = a;
            data.push([angle, a])
            date = new Date(ts)
            gs = session_data.gridsquares[i];
            if (gs !== lastGs) {
                lastGs = gs;
                gsLines.push({color: 'gray', value: date, width: 1});
            }

            data_defocus.push([ts, session_data.defocus[i]]);
            data_resolution.push([ts, session_data.resolution[i]])
            ts += config.stepX;
        }
        config.maxY = config.maxY + (config.maxY * 0.1)
        session_plots.defocus = create_hc_defocus_series('defocus_plot', {
            points: data_defocus,
            lines: gsLines,
            min: Math.min(...session_data.defocus),
            max: Math.max(...session_data.defocus)
        }, );
        session_plots.defocusHist = create_hc_defocus_histogram('defocus_hist1', session_data.defocus, 70);

        //session_plots.resolution = create_hc_series('resolution_plot', data_resolution, config);
        session_plots.resolution = create_hc_resolution_series('resolution_plot', {
            points: data_resolution,
            lines: gsLines,
            min: Math.min(...session_data.resolution),
            max: Math.max(...session_data.resolution)
        });

        session_plots.resolutionHist = create_hc_resolution_histogram('resolution_hist1', session_data.resolution, 70);

        config.color = '#55D8C1';
        config.maxY = 0.2;
        session_plots.polarAll = create_hc_polar('polar1', data, 'Azimuth (all)', config);
        session_plots.polar10 = create_hc_polar('polar4', data.slice(Math.round(data.length * 0.9)),
                        'Azimuth (last 10%)', config);
    }
    else {  // update existing plots
        // session_plots.defocus.series[0].setData(session_data.defocus);
        // session_plots.defocusHist = create_hc_defocus_histogram('defocus_hist1', session_data.defocus, 70);
        // session_plots.resolution.series[0].setData(session_data.resolution);
        // session_plots.resolutionHist = create_hc_resolution_histogram('resolution_hist1', session_data.resolution, 70);
        //
    }
}


function session_get2DClasses(){
    overlay_2d.show("Loading 2D classes...");
    requestSessionData({result: 'classes2d'});
}


function formatBytes(a,b=2){if(!+a)return"0 Bytes";const c=0>b?0:b,d=Math.floor(Math.log(a)/Math.log(1024));return`${parseFloat((a/Math.pow(1024,d)).toFixed(c))} ${["Bytes","KiB","MiB","GiB","TiB","PiB","EiB","ZiB","YiB"][d]}`}


function create_hc_data_plot(containerId, data_usage_series) {
    var minTs = data_usage_series[0].data[0][0];
    var maxTs = 0;

    for (var i = 0; i < data_usage_series.length; ++i) {
        var data = data_usage_series[i].data;
        var sum = 0;
        for (var j = 0; j < data.length; j++) {
            minTs = Math.min(minTs, data[j][0]);
            maxTs = Math.max(maxTs, data[j][0]);
            sum += data[j][1];
            data[j][1] = sum;
        }
    }

    var oneDay = 24 * 3600 * 1000;
    var days = (maxTs - minTs) / oneDay;
    var interval = days < 30 ? 7 : 14;

    return Highcharts.chart(containerId, {
        title: {
            text: '',
            align: 'left'
        },
        subtitle: {
            text: 'Accumulated data per scope',
            align: 'left'
        },
         xAxis: {
            tickInterval: interval * oneDay,
            type: 'datetime',
            tickWidth: 0,
            gridLineWidth: 1,
            labels: {
                align: 'left',
                x: 3,
                y: -3
            }
        },
        yAxis: [{ // left y axis
            title: {
                text: null
            },
            labels: {
                align: 'left',
                x: -10,
                y: 16,
                formatter: function () { return formatBytes(this.value) }
            },
            showFirstLabel: false
        }, { // right y axis
            linkedTo: 0,
            gridLineWidth: 0,
            opposite: true,
            title: {
                text: null
            },
            labels: {
                align: 'right',
                x: -3,
                y: 16,
                formatter: function () { return formatBytes(this.value) }
            },
            showFirstLabel: false
        }],
        tooltip: {
            shared: true,
            crosshairs: true,
            pointFormatter: function () {
                return '<br/><span style="font-size:11px; font-width: bold;color: ' + this.series.color + '">' + this.series.name
                    + ': </span><span style="font-size:11px;">' + formatBytes(this.y) + '</span>';
            },
            useHTML: true
        },

        plotOptions: {
            series: {
                marker: {
                    lineWidth: 1
                }
            }
        },
        series: data_usage_series
    });
}


// ---------- Network related functions ----------------
var network_colors = {
  saved: '#CBF6F8',  // water
  launched: '#A8E4EF',  // Blizzard Blue
  //'#0CC078',  // Crayola's Green
  //finished: '#79DE79',  // Pastel Green
  finished: '#BBEC7B',
  interactive: '#FCFC99',  // Pastel Yellow
  running: '#FFC634',  // Sunglow (African heart palette)
  aborted: '#DD9789', //'#ABABC3',
  scheduled: '#F0D17A',
  failed: '#FB6962',  // Pastel Red
};


function createNetwork(container, workflow) {
    var nodes = new vis.DataSet();

    for (var i = 0;  i < workflow.length; i++){
        var prot = workflow[i];
        var c = network_colors[prot['status']];
        var label = prot['label'];
        if (label !== prot['id'])
            label += "(id=" + prot['id'] + ")";

        nodes.add({
            id: prot['id'],
            label: label,
            widthConstraint: { minimum: 120, maximum: 180 },
            labelHighlightBold: false,
            color: {
              background: c,
              highlight: {
                border: 'black',
                background: c
              },
              hover: {
                border: 'black',
                background: c
              },
            }
          });
    }

    var edges = new vis.DataSet();

    for (var i = 0;  i < workflow.length; i++){
        var prot = workflow[i];
        for (var j = 0; j < prot.links.length; j++){
            edges.add({from: prot.id, to: prot.links[j]});
        }
    }

    var data = {
        nodes: nodes,
        edges: edges,
    };

    var options = {
        edges: {
          font: {
            size: 12,
          },
          widthConstraint: {
            maximum: 90,
          },
          arrows: {
          from: {
              enabled: true,
              type: "circle",
            },
            to: {
              enabled: true,
              type: "arrow",
            },
          },
        },
        nodes: {
          shape: "box",
          margin: 10,
          widthConstraint: {
            maximum: 200,
          },
        },
        physics: {
          enabled: false,
        },
        layout: {
          hierarchical: {
            direction: "UD",
            sortMethod: "directed", // "directed"
              shakeTowards: "roots",
              nodeSpacing: 200,
              parentCentralization: true,
              edgeMinimization: true,
              blockShifting: true
          }
        },
        interaction: {
            hover: true,
            multiselect: true,
        }
    };

    return new vis.Network(container, data, options);
}
