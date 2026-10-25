// Plotly React component bound to the minified plotly.js distribution
// (react-plotly.js would otherwise pull the full plotly.js source build).
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

export default Plot;
