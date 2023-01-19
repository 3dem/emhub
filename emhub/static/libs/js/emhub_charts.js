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
        }]
    });
} // function create_hc_series

function create_hc_histogram(containerId, data, config) {
    var chart = Highcharts.chart(containerId, {
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
        opposite: false
      }, {
        title: {
          text: config.label + ' (' + config.suffix + ')'
        },
        alignTicks: true,
        opposite: false,
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
          binsNumber: 25
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
