const width = window.innerWidth > 980 ? window.innerWidth - 370 : window.innerWidth;
const height = window.innerWidth > 980 ? window.innerHeight : Math.max(window.innerHeight * 0.72, 560);

const svg = d3.select("#graph-svg").attr("viewBox", [0, 0, width, height]);
const root = svg.append("g");
const linkLayer = root.append("g").attr("class", "links");
const nodeLayer = root.append("g").attr("class", "nodes");
const labelLayer = root.append("g").attr("class", "labels");

const pathInput = document.getElementById("graph-path");
const loadButton = document.getElementById("load-default");
const fileInput = document.getElementById("file-input");
const searchInput = document.getElementById("search-input");
const chargeInput = document.getElementById("charge-input");
const labelsToggle = document.getElementById("labels-toggle");
const statusText = document.getElementById("status-text");
const legendList = document.getElementById("legend-list");
const detailsContent = document.getElementById("details-content");

const statSource = document.getElementById("stat-source");
const statNodes = document.getElementById("stat-nodes");
const statEdges = document.getElementById("stat-edges");
const statTypes = document.getElementById("stat-types");

const colorByType = {
  CLAUSE: "#c26d38",
  PARTY: "#0f766e",
  DEFINED_TERM: "#5b5bd6",
  OBLIGATION: "#b42318",
  RIGHT: "#1d4ed8",
  PROHIBITION: "#7c2d12",
  CONDITION: "#9333ea",
  REFERENCE: "#475569",
  VALUE: "#b45309"
};

let simulation = null;
let currentGraph = null;
let selectedNodeId = null;
let neighborMap = new Map();

const zoom = d3.zoom()
  .scaleExtent([0.2, 4])
  .on("zoom", (event) => {
    root.attr("transform", event.transform);
  });

svg.call(zoom);

loadButton.addEventListener("click", () => loadGraphFromPath(pathInput.value.trim()));
fileInput.addEventListener("change", handleFileOpen);
searchInput.addEventListener("input", applySearch);
chargeInput.addEventListener("input", rerunForces);
labelsToggle.addEventListener("change", () => {
  labelLayer.style("display", labelsToggle.checked ? null : "none");
});

window.addEventListener("resize", () => window.location.reload());

async function loadGraphFromPath(path) {
  if (!path) {
    setStatus("Provide a JSON path to load.");
    return;
  }

  setStatus(`Loading ${path}...`);
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    renderGraph(data);
    setStatus(`Loaded ${data.source_file || path}`);
  } catch (error) {
    setStatus(`Failed to load graph: ${error.message}`);
  }
}

function handleFileOpen(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      renderGraph(data);
      setStatus(`Loaded ${file.name}`);
    } catch (error) {
      setStatus(`Invalid JSON file: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function renderGraph(data) {
  const nodes = (data.nodes || []).map((node) => ({ ...node }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const links = (data.edges || [])
    .filter((edge) => nodeById.has(edge.src) && nodeById.has(edge.tgt))
    .map((edge) => ({
      ...edge,
      source: nodeById.get(edge.src),
      target: nodeById.get(edge.tgt)
    }));

  currentGraph = { ...data, nodes, links };
  selectedNodeId = null;
  neighborMap = buildNeighborMap(nodes, links);

  statSource.textContent = data.source_file || "-";
  statNodes.textContent = nodes.length;
  statEdges.textContent = links.length;
  statTypes.textContent = new Set(nodes.map((node) => node.node_type || "UNKNOWN")).size;
  renderLegend(nodes);

  detailsContent.innerHTML = '<p class="muted">Select a node to inspect its attributes and connected relations.</p>';

  if (simulation) {
    simulation.stop();
  }

  const linkSelection = linkLayer
    .selectAll("line")
    .data(links, (d) => `${d.src}|${d.type}|${d.tgt}`)
    .join("line")
    .attr("class", "link");

  const nodeSelection = nodeLayer
    .selectAll("circle")
    .data(nodes, (d) => d.id)
    .join("circle")
    .attr("class", "node")
    .attr("r", (d) => radiusForNode(d))
    .attr("fill", (d) => colorByType[d.node_type] || "#64748b")
    .on("click", (_, d) => selectNode(d))
    .call(dragBehavior());

  const labelSelection = labelLayer
    .selectAll("text")
    .data(nodes, (d) => d.id)
    .join("text")
    .attr("class", "node-label")
    .text((d) => labelForNode(d));

  labelLayer.style("display", labelsToggle.checked ? null : "none");

  simulation = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(linkDistance))
    .force("charge", d3.forceManyBody().strength(Number(chargeInput.value)))
    .force("collide", d3.forceCollide().radius((d) => radiusForNode(d) + 10))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("x", d3.forceX(width / 2).strength(0.03))
    .force("y", d3.forceY(height / 2).strength(0.03))
    .on("tick", () => {
      linkSelection
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);

      nodeSelection
        .attr("cx", (d) => d.x)
        .attr("cy", (d) => d.y);

      labelSelection
        .attr("x", (d) => d.x + radiusForNode(d) + 4)
        .attr("y", (d) => d.y + 3);
    });

  svg.transition().duration(400).call(
    zoom.transform,
    d3.zoomIdentity.translate(0, 0).scale(1)
  );

  applySearch();
}

function buildNeighborMap(nodes, links) {
  const map = new Map(nodes.map((node) => [node.id, new Set([node.id])]));
  links.forEach((link) => {
    map.get(link.source.id)?.add(link.target.id);
    map.get(link.target.id)?.add(link.source.id);
  });
  return map;
}

function selectNode(node) {
  selectedNodeId = node.id;
  renderDetails(node);
  updateHighlightState();
}

function renderDetails(node) {
  const connectedLinks = currentGraph.links.filter(
    (link) => link.source.id === node.id || link.target.id === node.id
  );

  const fields = Object.entries(node).filter(([, value]) => value !== null && value !== "");
  const relations = connectedLinks.map((link) => {
    const direction = link.source.id === node.id ? "out" : "in";
    const counterpart = direction === "out" ? link.target : link.source;
    return `${direction.toUpperCase()} · ${link.type} · ${labelForNode(counterpart)}`;
  });

  detailsContent.innerHTML = `
    <h3>${escapeHtml(labelForNode(node))}</h3>
    <div class="details-grid">
      ${fields.map(([key, value]) => `
        <div class="detail-row">
          <span class="detail-key">${escapeHtml(key)}</span>
          <div>${escapeHtml(stringifyValue(value))}</div>
        </div>
      `).join("")}
    </div>
    <div>
      <h3>Connected relations</h3>
      <div class="related-list">
        ${relations.length ? relations.map((item) => `<div class="related-item">${escapeHtml(item)}</div>`).join("") : '<p class="muted">No connected relations.</p>'}
      </div>
    </div>
  `;
}

function applySearch() {
  if (!currentGraph) {
    return;
  }

  const query = searchInput.value.trim().toLowerCase();
  const matches = query
    ? new Set(
        currentGraph.nodes
          .filter((node) => JSON.stringify(node).toLowerCase().includes(query))
          .map((node) => node.id)
      )
    : null;

  nodeLayer.selectAll(".node")
    .classed("dimmed", (d) => matches ? !matches.has(d.id) : false);

  labelLayer.selectAll(".node-label")
    .classed("dimmed", (d) => matches ? !matches.has(d.id) : false);

  linkLayer.selectAll(".link")
    .classed("dimmed", (d) => matches ? !(matches.has(d.source.id) || matches.has(d.target.id)) : false);

  updateHighlightState();
}

function updateHighlightState() {
  const activeNeighbors = selectedNodeId ? neighborMap.get(selectedNodeId) || new Set() : null;

  nodeLayer.selectAll(".node")
    .classed("active", (d) => d.id === selectedNodeId)
    .classed("dimmed", function (d) {
      const searchDimmed = d3.select(this).classed("dimmed");
      if (searchDimmed) {
        return true;
      }
      return activeNeighbors ? !activeNeighbors.has(d.id) : false;
    });

  labelLayer.selectAll(".node-label")
    .classed("dimmed", function (d) {
      const searchDimmed = d3.select(this).classed("dimmed");
      if (searchDimmed) {
        return true;
      }
      return activeNeighbors ? !activeNeighbors.has(d.id) : false;
    });

  linkLayer.selectAll(".link")
    .classed("active", (d) => selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId))
    .classed("dimmed", function (d) {
      const searchDimmed = d3.select(this).classed("dimmed");
      if (searchDimmed) {
        return true;
      }
      return activeNeighbors ? !(d.source.id === selectedNodeId || d.target.id === selectedNodeId) : false;
    });
}

function renderLegend(nodes) {
  const typeCounts = d3.rollups(
    nodes,
    (values) => values.length,
    (node) => node.node_type || "UNKNOWN"
  ).sort((a, b) => d3.descending(a[1], b[1]));

  legendList.innerHTML = typeCounts.map(([type, count]) => `
    <li class="legend-item">
      <span class="legend-swatch" style="background:${colorByType[type] || "#64748b"}"></span>
      <span>${escapeHtml(type)} (${count})</span>
    </li>
  `).join("");
}

function rerunForces() {
  if (!simulation) {
    return;
  }

  simulation.force("charge").strength(Number(chargeInput.value));
  simulation.alpha(0.8).restart();
}

function dragBehavior() {
  function dragStarted(event) {
    if (!event.active) {
      simulation.alphaTarget(0.3).restart();
    }
    event.subject.fx = event.subject.x;
    event.subject.fy = event.subject.y;
  }

  function dragged(event) {
    event.subject.fx = event.x;
    event.subject.fy = event.y;
  }

  function dragEnded(event) {
    if (!event.active) {
      simulation.alphaTarget(0);
    }
    event.subject.fx = null;
    event.subject.fy = null;
  }

  return d3.drag().on("start", dragStarted).on("drag", dragged).on("end", dragEnded);
}

function radiusForNode(node) {
  const byType = {
    CLAUSE: 13,
    OBLIGATION: 11,
    RIGHT: 11,
    PROHIBITION: 11,
    PARTY: 10,
    CONDITION: 9,
    DEFINED_TERM: 8,
    REFERENCE: 8,
    VALUE: 7
  };
  return byType[node.node_type] || 8;
}

function linkDistance(link) {
  const distanceByType = {
    CONTAINS: 70,
    ASSIGNS_OBLIGATION_TO: 95,
    GRANTS_RIGHT_TO: 95,
    ASSIGNS_PROHIBITION_TO: 95,
    DEPENDS_ON: 105,
    REFERENCES: 110,
    USES: 80,
    DEFINES: 80,
    HAS_VALUE: 72,
    CITES: 86
  };
  return distanceByType[link.type] || 85;
}

function labelForNode(node) {
  return node.clause_id || node.term || node.name || node.action || node.trigger || node.amount || node.id;
}

function stringifyValue(value) {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

loadGraphFromPath(pathInput.value.trim());
