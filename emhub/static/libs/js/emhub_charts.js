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
                        let gs = nonEmpty(session_data) ? session_data.gridsquares[micIndex] : '';
                        tooltip = '<span>' + gs + '</span><br/><br/>' +
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
function drawMicrograph(containerId, micrograph, drawValue) {
    var canvas = document.getElementById(containerId);
    var ctx = canvas.getContext("2d");

    var image = new Image();

    image.onload = function() {
        if (canvas.height != image.height) {
            let image_ratio = image.width / parseFloat(image.height);

            canvas.width = image.width;
            canvas.height = canvas.width / image_ratio;
            //canvas.width = image.width;
            //canvas_ratio = canvas.width / parseFloat(canvas.height);

        }
        let canvas_image_ratio = canvas.width / parseFloat(image.width);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);


        if (drawValue === 'none' || micrograph.coordinates.length == 0)
            return;

        ctx.fillStyle = '#00ff00';
        ctx.strokeStyle = '#00ff00';

        // Adjust the scale of the coordinates taking into account two factors:
        // 1) scale between the original micrograph and the thumbnail size
        // 2) scale between the thumbnail and the canvas size
        var scale =  canvas_image_ratio * parseFloat(micrograph.pixelSize) / (micrograph.thumbnailPixelSize);
        var coords = micrograph.coordinates;

        for (var i = 0; i < coords.length; ++i){
            var x = Math.round(coords[i][0] * scale);
            var y = Math.round(coords[i][1] * scale);
            ctx.beginPath();
            if (drawValue === 'circle') {
                ctx.arc(x, y, 10, 0, 2 * Math.PI);
                ctx.stroke();
            }
            else {
                ctx.arc(x, y, 2, 0, 2 * Math.PI);
                ctx.fill();
            }

        }
    };

    image.src = 'data:image/png;base64,' + micrograph.thumbnail;
}

function drawClasses2d(containerId, classes, header, showSel){
    var container = document.getElementById(containerId);
    var imgStr, infoStr = null;
    var html = '<div class="col-12">' + header + '</div>';

    for (var cls2d of classes) {
        let borderColor = showSel && cls2d.sel ? 'limegreen' : 'white';
        imgStr = '<img width="100px" src="data:image/png;base64,' + cls2d.average + '" style="border: solid 3px ' + borderColor + ';">';
        infoStr = '<p class="text-muted mb-0"><small>size: ' + cls2d.size + ', id: ' + cls2d.id + '</small></p>';
        html += '<div style="padding: 3px; min-width: 90px;">' + imgStr + infoStr + '</div>';

    }
    container.innerHTML = html;
}

function drawVolData(containerId, volSlices){
    var container = document.getElementById(containerId);
    var imgStr, infoStr = null;
    var html = '<div class="col-12 row">';

    // for(let slice in volSlices) {
    //     imgStr = '<img src="data:image/png;base64,' + volSlices[slice] + '" style="border: solid 3px;">';
    //     infoStr = '<p class="text-muted mb-0"><small>' + slice + '</small></p>';
    //     html += '<div style="padding: 3px; min-width: 90px;">' + imgStr + infoStr + '</div>';
    // }
    for (const [sliceIndex, sliceImg] of Object.entries(volSlices)) {
      //console.log(`${key}: ${value}`);
        imgStr = '<img src="data:image/png;base64,' + sliceImg + '" style="border: solid 3px; width: 128px">';
        infoStr = '<p class="text-muted mb-0"><small>' + sliceIndex + '</small></p>';
        html += '<div style="padding: 1px; min-width: 128px;">' + imgStr + infoStr + '</div>';
    }
    container.innerHTML = html + '</div>';
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


class Card {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
    }

    id(suffix) {
        return this.containerId + '_' + suffix;
    }

    jid(suffix) {
        return '#' + this.id(suffix)
    }
} // class Card


class ImageSliderCard extends Card {
    constructor(containerId, slices, config) {
        super(containerId);
        let self = this;
        this.indexes = [];
        this.slices = slices;
        this.slider_prefix = getObjectValue(config, 'slider_prefix', '');

        const width = getObjectValue(config, 'slice_dim', 128);
        var styleStr = '" style="width: ' + width + 'px"';

        var html = '<div class="row"><div class="col-12"><img id="' + this.id('image') + styleStr + '></div>';

        for (const [sliceIndex, sliceImg] of Object.entries(slices)) {
            this.indexes.push(sliceIndex);
            //console.log(`${sliceIndex}: ${sliceImg.length}`);
        }

        const N = this.indexes.length;
        html += '<div class="col-12"><input id="' + this.id('slider_input') + styleStr + '" type="range" min="0" value="0" max="' + (N - 1) + '" step="1"></div>';
        html += '<div class="col-12"><div id="' + this.id('slider_text') + '"></div></div>';

        this.container.innerHTML = html;

        $(this.jid('slider_input')).on("input", function() {
            self.setSlice($(this).val());
        });

        let initialSlice = getObjectValue(config, 'initial_slice', Math.floor(N / 2));
        this.setSlice(initialSlice);

    }

    setSlice(sliceIndex) {
        $(this.jid('slider_input')).val(sliceIndex);
        const sliceNumber = this.indexes[sliceIndex];
        const sliceImg = this.slices[sliceNumber];
        var img = document.getElementById(this.id('image'));
        img.src = "data:image/png;base64, " + sliceImg;
        $(this.jid('slider_text')).text(this.slider_prefix + sliceNumber);
    }
}

class VolumeSliderCard extends Card {
    constructor(containerId, slices, config) {
        super(containerId);
        let self = this;
        this.slices = slices;
        const slice_dim = getObjectValue(config, 'slice_dim', 128);
        const width = Math.floor(slice_dim * 1.2);

        const minWidth = 3 * width;
        var html = '<div class="row ml-1 mr-1" style="min-width: ' + minWidth + 'px">';
        const styleStr = '" style="width: ' + width + 'px">';
        html += '<div id="' + this.id('slider-z') + styleStr + '</div>';
        html += '<div id="' + this.id('slider-y') + styleStr + '</div>';
        html += '<div id="' + this.id('slider-x') + styleStr + '</div></div>';

        this.container.innerHTML = html;

        this.isz = new ImageSliderCard(this.id('slider-z'), slices.z,
            {slider_prefix: 'Z slice: ', slice_dim: slice_dim});
        this.isy = new ImageSliderCard(this.id('slider-y'), slices.y,
            {slider_prefix: 'Y slice: ', slice_dim: slice_dim});
        this.isx = new ImageSliderCard(this.id('slider-x'), slices.x,
            {slider_prefix: 'X slice: ', slice_dim: slice_dim});

    }
}


function createVolume(array, dimensions) {

    //volComp.autoView();

    console.log(surface.getParameters());
}


function renderVolume3D(containerId, arrayJson, dimensions) {
    //var data = JSON.parse(dataJson);
    var array = new Uint8Array(atob(arrayJson).split("").map(function (c) {
            return c.charCodeAt(0);
        }));
        const nx = dimensions[0], ny = dimensions[1], nz = dimensions[2];
        const cx = nx / 2, cy = ny / 2, cz = nz / 2;
        var volume = new NGL.Volume("volume", '', array, nx, ny, nz);
        var stage = new NGL.Stage(containerId);
        var volComp = stage.addComponentFromObject(volume);
        var surface = volComp.addRepresentation("surface",
            {isolevelType: 'value', isolevel: 180});
        volComp.setPosition([-cx, -cy, -cz]);

        const sliderId = '#' + containerId + "_slider";

        $(sliderId).val(surface.getParameters()['isolevel']);
        $(sliderId).on("input", function() {
            surface.setParameters({isolevel: parseInt($(this).val())});
        });
} // function drawVolume3D



class MicrographCard extends Card {
    constructor(containerId, params, gsCard) {
        super(containerId);
        this.overlay = new Overlay(this.id('overlay'));
        this.gsCard = gsCard;
        // Parameters used to load the micrograph data
        this.params = params;
        let self = this;

        // Bind enter key with micrograph number input
        $(self.jid('mic_id')).on('keyup', function (e) {
            if (e.key === 'Enter' || e.keyCode === 13) {
                self.loadMicData($(self.jid('mic_id')).val());
            }
        });

        $(self.jid('mic_left')).on('click', function (e) {
           self.loadMicData(parseInt($(self.jid('mic_id')).val()) - 1);
        });
        $(self.jid('mic_right')).on('click', function (e) {
            self.loadMicData(parseInt($(self.jid('mic_id')).val()) + 1);
        });

        // Bind to on/off coordinates display
        // $(self.jid('show_particles')).change(function() {
        //     self.drawMicrograph();
        // });

        if (self.contains('particles')) {
            $('input[name="' + self.id('pts_switch') + '"]').change(function () {
                self.drawMicrograph();
            })
        }

    }

    /* Check if the card has an element with that id */
    contains(elementId) {
        return $(this.jid(elementId)).length > 0;
    }

    drawMicrograph() {
        let value= this.contains('particles') ? $('input[name="' + this.id('pts_switch') + '"]:checked').val() : 'none';
        drawMicrograph(this.id('mic_canvas'), this.micrograph, value);
    }

    loadMicData(micId, doneCallback) {
        let self = this;
        let t = new Timer()

        $(this.jid('mic_id')).val(micId);

        this.overlay.show("Loading Micrograph " + micId + " ...");

        this.params.mic_id = micId;

        var requestMicThumb = $.ajax({
            url: Api.urls.get_mic_data,
            type: "POST",
            data: this.params,
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

            if (data.psdData) {
                $(self.jid('img_psd')).attr('src', 'data:image/png;base64,' + data.psdData);
            }
            else
                $(self.jid('img_psd')).hide();

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
                if (self.contains('ctf_plot') && nonEmpty(data['ctfPlot']))
                    create_pl_ctfplot(self.id('ctf_plot'), data['ctfPlot']);
            }
            else {
                let uva = data['ctfDefocusU'] + ', ' + data['ctfDefocusV'] + ', ' + data['ctfDefocusAngle'];
                $(self.jid('mic_defocus_uva')).text(uva);
            }

            $(self.jid('mic_resolution')).text(data['ctfResolution']);

            if (self.contains('particles'))
                $(self.jid('particles')).val(micrograph.coordinates.length);

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


class GridSquareCard extends Card {
    constructor(containerId) {
        super(containerId);
        this.overlay = new Overlay(this.id('overlay'));
        this.last = null;
    }

    loadData(gridSquare) {
        // Do not load if it is the same GridSquare
        if (gridSquare == this.last)
            return;

        let self = this;
        var attrs = {session_id: session_id, gsId: gridSquare};
        this.last = gridSquare;
        this.overlay.show('Loading ' + gridSquare);

        var requestMicImg = $.ajax({
            url: Api.urls.get_micrograph_gridsquare,
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

class PlotCard extends Card {
    constructor(containerId, dataDict) {
        super(containerId);
        let self = this;
        this.dataDict = dataDict;
        this.set_default('labelX-select', 'default_x')
        this.set_default('labelY-select', 'default_y')
        this.set_default('labelColor-select', 'default_color')

         $(this.jid('update-plots-btn')).on('click', function (e) {
            self.makePlots();
         });
    }

    set_default(selectId, valueKey){
        let value = this.dataDict[valueKey]
        if (nonEmpty(value)) {
            $(this.jid(selectId)).selectpicker('val', value);
        }
    }
    makePlots() {
        //$('#update-plots-btn').toggleClass('btn-dark btn-outline-dark');
        let self = this;
        let label_x = $(this.jid('labelX-select')).selectpicker('val');
        let data_x = this.dataDict[label_x].data;

        let label_y = $(this.jid('labelY-select')).selectpicker('val');
        let data_y = this.dataDict[label_y].data;

        let label_color = $(this.jid('labelColor-select')).selectpicker('val');
        let data_color = this.dataDict[label_color].data;

        let colorscale = [[0.0, '#440154'], [0.1111111111111111,
                                            '#482878'], [0.2222222222222222,
                                            '#3e4989'], [0.3333333333333333,
                                            '#31688e'], [0.4444444444444444,
                                            '#26828e'], [0.5555555555555556,
                                            '#1f9e89'], [0.6666666666666666,
                                            '#35b779'], [0.7777777777777778,
                                            '#6ece58'], [0.8888888888888888,
                                            '#b5de2b'], [1.0, '#fde725']];
        var data = [
            {'fillcolor': 'white',
                  'marker': {'color': data_color,
                             'colorscale': 'Portland',
                             'opacity': 0.75,
                                'size': 10,
                             'showscale': true},
                  'mode': 'markers',
                  'type': 'scattergl',
                  'x': data_x,
                  'y': data_y },
             {'marker': {'color': 'cornflowerblue', 'opacity': 0.5},
              'name': label_x,
              'type': 'violin',
              'x': data_x,
              'yaxis': 'y2'},
             {'marker': {'color': 'cornflowerblue', 'opacity': 0.5},
              'name': label_y,
              'type': 'violin',
              'xaxis': 'x2',
              'y': data_y}
        ];

        var layout = {'bargap': 0,
           'hovermode': 'closest',
           'margin': {'t': 50, 'l': 0, 'r': 0},
           'autosize': true,
           'plot_bgcolor': 'rgba(0,0,0,0)',
           'showlegend': false,
           'template': '...',
           'xaxis': {'domain': [0, 0.85], 'gridcolor': '#CBCBCB', 'title': {'text': label_x}, 'zeroline': true},
           'xaxis2': {'domain': [0.85, 1], 'showgrid': true, 'zeroline': false},
           'yaxis': {'domain': [0, 0.85],
                     'gridcolor': '#CBCBCB',
                     'title': {'text': label_y},
                     'zeroline': true},
           'yaxis2': {'domain': [0.85, 1], 'showgrid': true, 'zeroline': false}};

        Plotly.newPlot(self.id('plotDiv'), data, layout);
        let graphDiv = document.getElementById(self.id('plotDiv'));

        graphDiv.on('plotly_selected', function(eventData) {
            if (!eventData) {
                $('#selection-label').text("No points selected.");
                $('#export-btn').hide();
                return;
            }
            let points = eventData.points;
            $(self.jid('selection-label')).html("Selected <label style='color: firebrick; font-size: medium;'>" + points.length + "</label> points")
            $(self.jid('export-btn')).show();
        });

        graphDiv.on('plotly_doubleclick', function(eventData) {
            alert('click');
        });

        graphDiv.on('plotly_click', function(eventData) {
            let index = eventData.points[0].pointNumber;
            if (self.onPointClick) {
                self.onPointClick(index);
            }
            //
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
        url: Api.urls.get_session_data,
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

    if (stats.movies.first > 0) {
       first = stats.movies.first;
       last = stats.movies.last;
    } else {
       first = stats.ctfs.first;
       last = stats.ctfs.last;
    }

    session_timespan.first = first * 1000;
    session_timespan.step = (last - first) * 1000 / nMovies;

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

function create_hc_sessions_time(containerId, data, config) {
    //var dates = ["2019-06-01", "2019-07-01", "2021-08-01"],
    //frequencies = [2, 6, 12];
    var columnsColor = getObjectValue(config, 'columnsColor', null);
    var splineColor = getObjectValue(config, 'splineColor', '#4d4d4d');
    var yAxis = null;

    // We can have one or two yAxis
    if (config.yAxis.length > 1){
        yAxis = [{min: 0, title: {text: config.yAxis[0]}},
                 {min: 0, title: {text: config.yAxis[1]}, opposite: true}];
    }
    else {
        yAxis = {min: 0, title: {text: config.yAxis[0]}};
    }

    Highcharts.chart(containerId, {
      title: {
        text: config.title
      },
      xAxis: {
        type: 'datetime',
        ordinal: true,
        labels: {
        },
         tickPositioner: function() {
          return data.map(function(point) {
            return Date.parse(point[0]);
          });
        }
      },
      yAxis: yAxis,
      plotOptions: {
        column: {
          pointPadding: 0.2,
          borderWidth: 0
        }
      },
      series: [
          {
              name: config.dataNames[0],
              type: 'column',
              showInLegend: true,
              color: columnsColor,
              data: (function() {
                  return data.map(function(point) {
                    return [Date.parse(point[0]), point[1]];
                  });
              })()
          }
          ,
          {
              name: config.dataNames[1],
              type: 'spline',
              yAxis: config.yAxis.length > 1 ? 1 : 0,
              showInLegend: true,
              color: splineColor,
              data: (function() {
                  return data.map(function(point) {
                    return [Date.parse(point[0]), point[2]];
                  });
              })()
          }
      ]

});

} // function hc_create_sessions_time

function create_hc_sessions_histogram(containerId, data) {
    Highcharts.chart(containerId, {
    title: {
        text: 'Images per Session'
    },

    xAxis: {
        title: { text: 'Images' },
        alignTicks: true
    },

    yAxis: {
        title: { text: 'Sessions' }
    },

    plotOptions: {
        histogram: {
            accessibility: {
                point: {
                    valueDescriptionFormat: '{index}. {point.x} to {point.x2}, {point.y}.'
                }
            }
        }
    },

    series: [{
        name: 'Number of Images',
        type: 'histogram',
        data: data,
        baseSeries: 's1',
        id: 's1',
        showInLegend: false
    }]
});
} // function hc_create_histogram


function create_hc_motionplot() {
    var seriesData = [[100, 29.9], [150,71.5], [300,106.4]];
    var plotLines = [];
    var step = 100;
    var N = 500;

    for (var i = 0; i <= N; i+=step) {
    		plotLines.push({
        	value: i, // Value of where the line will appear
          width: 1 // Width of the line
        });
    }

    Highcharts.chart(containerId, {
        chart: {
        //height: 700,
            style: "dash",
    		height: "100%",
        //margin: 50
        },
        xAxis: {
        		min: 0,
            max: N,
            tickInterval: step,
            plotLines: plotLines
        },
        yAxis: {
        		min: 0,
            max: N,
            tickInterval: step,
        },

        series: [{
            data: seriesData
        }]
    });
} // function create_hc_motionplot

function create_pl_ctfplot(containerId, ctfvalues) {
     var data = [];
     for (i = 1; i <= 4; i++) {
         data.push({
          x: ctfvalues[0],
          y: ctfvalues[i],
          mode: 'lines',
          connectgaps: true
        });
     }

    // var data = [trace, trace2, trace3];

    var layout = {
        showlegend: true,
        autoscale: true,
        margin: {'t': 0, 'l': 10, 'r': 50},
    };

    Plotly.newPlot(containerId, data, layout);

} // function create_pl_ctfplot


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
