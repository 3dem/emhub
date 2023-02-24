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
             opposite: true
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
    var start = new Date();
    global_data = data;
    // Create the chart
    return Highcharts.stockChart(container, {
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

        yAxis: {
            title: {
                text: config.label + " (" + config.suffix + ")",
            },
            opposite: false
        },

        exporting: {enabled: false},
        legend: {enabled: false},
        title: undefined,
        series: [{
            name: config.label,
            data: data,
            pointStart: config.startX,  //start.getTime(),
            pointInterval: config.stepX,  //10000,
            tooltip: {
                valueDecimals: 2,
                valueSuffix: config.suffix,
            }
            // point: {
            //     events: {
            //         click: function () {
            //             console.log(this);
            //             alert('value: y' + this.y + ' i: ' + this.index);
            //         }
            //     }
            //}

        }]
    });
} // function create_hc_series


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


function create_hc_usage(containerId, chartType, usageData, drilldownData){
    // Create the chart
    Highcharts.chart(containerId, {
    chart: {
        type: chartType,
    },
    title: {
        text: '',
        align: 'left'
    },
    subtitle: {
        text: 'Click to view detailed usage.',
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


/* Draw the micrograph images with coordinates(optional) */
function drawMicrograph(micrograph) {
    var canvas = document.getElementById("canvas_micrograph");
    var ctx = canvas.getContext("2d");

    var image = new Image();

    image.onload = function() {
        if (canvas.height != image.height) {
            canvas.height = image.height;
            canvas.width = image.width;
            canvas_ratio = canvas.width / parseFloat(canvas.height);
        }

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        if (coordsDisplay === 'None')
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

function drawClasses2d(containerId, classes){
    var container = document.getElementById(containerId);
    var imgStr, infoStr = null;
    container.innerHTML = '';
    for (var cls2d of classes) {
        imgStr = '<img src="data:image/png;base64,' + cls2d.average + '">';
        infoStr = '<p class="text-muted mb-0"><small>size: ' + cls2d.size + ', id: ' + cls2d.id + '</small></p>';
        container.innerHTML += '<div style="padding: 3px; min-width: 90px;">' + imgStr + infoStr + '</div>';
    }
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

/* --------------------------- Session Live functions ------------------------*/
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

                if (classes2d.length > 0) {
                    drawClasses2d('classes2d_container', classes2d);
                    overlay_2d.hide();
                }
                else if ('defocus' in jsonResponse) {
                    var count = session_data == null ? 0 : session_data.resolution.length;
                    session_data = jsonResponse;
                    // TODO: Update Defocus plot with new values since last time
                    var new_count = session_data.resolution.length;
                    if (new_count > count) {
                        session_updatePlots();
                        session_getMicData(new_count);
                    }

                    if (session_data.session.status != "finished") {
                        setTimeout(session_reload, 30000);
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
    const width  = window.innerWidth || document.documentElement.clientWidth ||
    document.body.clientWidth;
    const height = window.innerHeight || document.documentElement.clientHeight ||
    document.body.clientHeight;

    if (width < 2000) {
        document.getElementById('ctf_plots').className = 'col-8';
        document.getElementById('image_plots').className = 'col-12';
    }
    else {
        document.getElementById('ctf_plots').className = 'col-5';
        document.getElementById('image_plots').className = 'col-5';
    }

    var canvas = document.getElementById("canvas_micrograph");
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
    session_setCounter('ctf_diff', nCtfs - nMovies);
    session_setCounter('ctf_speed', " " + Math.round(nCtfs/stats.ctfs.hours) + " / h");
    //setCounter('diff_ctf', stats['numOfCtfs'] - stats['numOfMics']);
    session_setCounter('imported_tag', " " + Math.round(nMovies/stats.movies.hours) + " / h");
    //fixme
    session_setCounter('counter_picked', 0);

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

        for (var i = 0; i < session_data.defocusAngle.length; ++i) {
            var angle = session_data.defocusAngle[i];
            if (angle < 0)
                angle = 360 + angle;
            const a = session_data.astigmatism[i];
            if (a > config.maxY)
                config.maxY = a;
            data.push([angle, a])
        }
        config.maxY = config.maxY + (config.maxY * 0.1)

        session_plots.defocus = create_hc_series('defocus_plot', session_data.defocus, config);
        session_plots.defocusHist = create_hc_defocus_histogram('defocus_hist1', session_data.defocus, 70);

        //create_hc_histogram('defocus_hist2', color);

        config.color ='#EF9A53';
        config.label = 'Resolution';
        config.suffix = 'Å';

        session_plots.resolution = create_hc_series('resolution_plot', session_data.resolution, config);
        session_plots.resolutionHist = create_hc_resolution_histogram('resolution_hist1', session_data.resolution, 70);

        config.color = '#55D8C1';
        session_plots.polarAll = create_hc_polar('polar1', data, 'Azimuth (all)', config);
        session_plots.polar10 = create_hc_polar('polar4', data.slice(Math.round(data.length * 0.9)),
                        'Azimuth (last 10%)', config);

        /* Register when the display coordinates changes */
        $('input[type=radio][name=coords-radio]').change(function() {
            coordsDisplay = this.dataset.option;
            drawMicrograph(micrograph);
        });
    }
    else {  // update existing plots
        session_plots.defocus.series[0].setData(session_data.defocus);
        session_plots.defocusHist = create_hc_defocus_histogram('defocus_hist1', session_data.defocus, 70);
        session_plots.resolution.series[0].setData(session_data.resolution);
        session_plots.resolutionHist = create_hc_resolution_histogram('resolution_hist1', session_data.resolution, 70);
    }
}


function session_getMicData(micId) {
    $("#mic_id").val(micId);

    overlay_mic.show("Loading Micrograph " + micId + " ...");

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

        session_getMicLocation(data);

        drawMicrograph(micrograph);

        $("#img_psd").attr('src', 'data:image/png;base64,' + data.psdData);
        function setLabel(containerId, value){
            var elem = document.getElementById(containerId);
            var parts = elem.innerHTML.split(":");
            elem.innerHTML = parts[0] + ": " + value;
        }

        //setLabel('mic_id', micId);
        $('#mic_defocus_u').text(data['ctfDefocusU']);
        $('#mic_defocus_v').text(data['ctfDefocusV']);
        $('#mic_defocus_angle').text(data['ctfDefocusAngle']);
        $('#mic_astigmatism').text(data['ctfAstigmatism']);
        $('#mic_resolution').text(data['ctfResolution']);

        overlay_mic.hide();
    });

    requestMicThumb.fail(function(jqXHR, textStatus) {
      alert( "Request failed: " + textStatus );
    });
}

function session_get2DClasses(){
    overlay_2d.show("Loading 2D classes...");
    requestSessionData({result: 'classes2d'});
}

function session_getMicLocation(data, label, container) {
    var attrs = {sessionId: session_id}

    if (data.gridSquare != lastGridSquare)
        attrs.gsId = data.gridSquare;

    lastGridSquare = attrs.gsId;
    lastFoilHole = attrs.fhId;

    var requestMicImg = $.ajax({
        url: urls.get_mic_location,
        type: "POST",
        data: attrs,
        dataType: "json"
    });

    requestMicImg.done(function(data) {
        if (data.gridSquare.thumbnail){
            //alert("Loaded " + label + " " + JSON.stringify(data, null, 4));
            $("#gs-image").attr('src', 'data:image/png;base64,' + data.gridSquare.thumbnail);
            create_hc_defocus_histogram('gs_defocus_hist', data.defocus, 80);
            create_hc_resolution_histogram('gs_resolution_hist', data.resolution, 80);
        }
    });

    requestMicImg.fail(function(jqXHR, textStatus) {
      alert(label + " Request failed: " + textStatus );
    });
}