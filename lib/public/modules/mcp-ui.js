// mcp-ui.js - MCP Servers UI for Project Settings panel
// Renders MCP server list with checkboxes, handles toggle messages.

import { getWs } from './ws-ref.js';
import { setHttpMcpServers } from './app-misc.js';

var _mcpServers = []; // { name, transport, toolCount, extensionEnabled, projectEnabled }

export function handleMcpServersState(msg) {
  _mcpServers = msg.servers || [];

  // Update HTTP MCP server registry for direct fetch calls
  setHttpMcpServers(_mcpServers);

  // Re-render if the settings panel is visible
  renderMcpServerList();
}

export function getMcpServers() {
  return _mcpServers;
}

export function renderMcpServerList() {
  var container = document.getElementById("mcp-servers-list");
  if (!container) return;

  container.innerHTML = "";

  var available = _mcpServers.filter(function (s) { return s.extensionEnabled; });

  if (available.length === 0) {
    var empty = document.createElement("p");
    empty.className = "mcp-no-servers";
    empty.textContent = "No MCP servers detected. Configure in Clay Chrome Extension.";
    container.appendChild(empty);
    return;
  }

  for (var i = 0; i < available.length; i++) {
    var server = available[i];
    var row = document.createElement("label");
    row.className = "mcp-server-row";

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = server.projectEnabled;
    cb.dataset.serverName = server.name;
    cb.addEventListener("change", onToggle);

    var nameSpan = document.createElement("span");
    nameSpan.className = "mcp-server-name";
    nameSpan.textContent = server.name;

    var countSpan = document.createElement("span");
    countSpan.className = "mcp-server-tools";
    countSpan.textContent = server.toolCount + " tool" + (server.toolCount === 1 ? "" : "s");

    var transportSpan = document.createElement("span");
    transportSpan.className = "mcp-server-transport";
    transportSpan.textContent = server.transport === "http" ? "HTTP" : "stdio";

    row.appendChild(cb);
    row.appendChild(nameSpan);
    row.appendChild(countSpan);
    row.appendChild(transportSpan);
    container.appendChild(row);
  }
}

function onToggle(e) {
  var name = e.target.dataset.serverName;
  var enabled = e.target.checked;
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "mcp_toggle_server",
      name: name,
      enabled: enabled,
    }));
  }
}
