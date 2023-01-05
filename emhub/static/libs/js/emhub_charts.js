/**
 * Created by J.M. de la Rosa on 05/01/2022
 */


function create_hc_polar(charDivId, config){
          var N = 100000;
    var data = [];
for (var i = 0; i < N; ++i)
    data.push(Math.random());

var graph = new Highcharts.Chart({
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
        text: 'Azimuth',
    },
    xAxis: {
    tickInterval: 45,
    min: 0,
    max: 360,
    labels: {
        format: ''
    }
},
 yAxis: {
     tickInterval: 0.5,
    min: 0,
    max: 1.2
},
credits: {enabled: false},
    series: [{
        name: 'Points',
        data: data,
        type: 'scatter',
        groupPadding: 0,
        pointPadding: 0,
    }
    ]

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
            pointStart: start.getTime(),
            pointInterval: 3600,
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