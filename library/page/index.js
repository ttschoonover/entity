// page · the republic's own web page, served by its node.
// With this module, a node serves the page every visitor uses to read, verify,
// vote and sign. Without it, the republic runs headless: its record, its signed
// acts and its windows (window.js, for other websites) still work, and its
// front door says so. It adds no acts and no settings; installing or removing
// it is a decision like any other.
function install() {}
export default { name: 'page', core: '0.4', install, parameterKeys: [] };
