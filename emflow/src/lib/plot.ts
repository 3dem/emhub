// Plotly React component bound to the minified plotly.js distribution
// (react-plotly.js would otherwise pull the full plotly.js source build).
// `Plotly` is also exported by the bundle (EMFlow.Plotly, window.Plotly),
// so the host page charts use this same plotly.js.
import createPlotlyComponent from "react-plotly.js/factory";
import Plotly from "plotly.js-dist-min";

const Plot = createPlotlyComponent(Plotly);

export { Plotly };
export default Plot;
