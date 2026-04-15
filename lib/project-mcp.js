var crypto = require("crypto");

// MCP Bridge module: manages remote MCP servers reported by the Chrome Extension.
// Creates proxy MCP server objects that forward tool calls over WebSocket.
// Follows the attachXxx(ctx) pattern per MODULE_MAP.md.

function attachMcp(ctx) {
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var getEnabledMcpServers = ctx.getEnabledMcpServers;
  var setEnabledMcpServers = ctx.setEnabledMcpServers;
  var getExtensionWs = ctx.getExtensionWs;

  // Available servers reported by extension: { name -> { name, transport, tools, enabled } }
  var _availableServers = {};

  // Proxy MCP server objects for the SDK: { name -> sdkMcpServerConfig }
  var _proxyServers = {};

  // Pending tool calls: { callId -> { resolve, reject, timer } }
  var _pendingCalls = {};

  var TOOL_TIMEOUT_MS = 30000;

  // ---------- Message Handler ----------

  function handleMcpMessage(ws, msg) {
    if (msg.type === "mcp_servers_available") {
      handleServersAvailable(ws, msg);
      return true;
    }
    if (msg.type === "mcp_tool_result") {
      handleToolResult(msg);
      return true;
    }
    if (msg.type === "mcp_tool_error") {
      handleToolError(msg);
      return true;
    }
    if (msg.type === "mcp_toggle_server") {
      handleToggleServer(ws, msg);
      return true;
    }
    return false;
  }

  function handleServersAvailable(ws, msg) {
    var servers = msg.servers || [];
    _availableServers = {};
    for (var i = 0; i < servers.length; i++) {
      var s = servers[i];
      _availableServers[s.name] = {
        name: s.name,
        transport: s.transport || "stdio",
        tools: s.tools || [],
        enabled: s.enabled !== false,
      };
    }

    // Rebuild proxy servers based on project-level enabled list
    rebuildProxyServers();

    // Broadcast updated state to all clients
    broadcastMcpState();
  }

  function handleToolResult(msg) {
    var callId = msg.callId;
    var pending = _pendingCalls[callId];
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    delete _pendingCalls[callId];
    pending.resolve(msg.result || { content: [{ type: "text", text: "(empty result)" }] });
  }

  function handleToolError(msg) {
    var callId = msg.callId;
    var pending = _pendingCalls[callId];
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    delete _pendingCalls[callId];
    pending.reject(new Error(msg.error || "MCP tool call failed"));
  }

  function handleToggleServer(ws, msg) {
    var name = msg.name;
    var enabled = !!msg.enabled;

    var list = getEnabledMcpServers() || [];
    var idx = list.indexOf(name);

    if (enabled && idx === -1) {
      list.push(name);
    } else if (!enabled && idx !== -1) {
      list.splice(idx, 1);
    }

    setEnabledMcpServers(list);
    rebuildProxyServers();
    broadcastMcpState();
  }

  // ---------- Proxy Server Builder ----------

  function rebuildProxyServers() {
    _proxyServers = {};

    var sdk;
    try {
      sdk = require("@anthropic-ai/claude-agent-sdk");
    } catch (e) {
      console.error("[mcp-bridge] Failed to load SDK:", e.message);
      return;
    }

    var createSdkMcpServer = sdk.createSdkMcpServer;
    var tool = sdk.tool;
    if (!createSdkMcpServer || !tool) {
      console.error("[mcp-bridge] SDK missing createSdkMcpServer or tool helper");
      return;
    }

    var z;
    try { z = require("zod").z; } catch (e) {
      try { z = require("zod"); } catch (e2) {
        console.error("[mcp-bridge] Failed to load zod:", e2.message);
        return;
      }
    }

    var enabledList = getEnabledMcpServers() || [];
    var serverNames = Object.keys(_availableServers);

    for (var si = 0; si < serverNames.length; si++) {
      var serverName = serverNames[si];
      var serverInfo = _availableServers[serverName];

      // Only build proxy for servers that are both extension-enabled and project-enabled
      if (!serverInfo.enabled) continue;
      if (enabledList.indexOf(serverName) === -1) continue;

      var tools = [];
      var serverTools = serverInfo.tools || [];

      for (var ti = 0; ti < serverTools.length; ti++) {
        var mcpTool = serverTools[ti];
        var toolName = mcpTool.name;
        var toolDesc = mcpTool.description || toolName;
        var shape = buildZodShape(z, mcpTool.inputSchema);

        tools.push(tool(
          toolName,
          toolDesc,
          shape,
          createToolHandler(serverName, toolName)
        ));
      }

      if (tools.length > 0) {
        var mcpServer = createSdkMcpServer({
          name: serverName,
          version: "1.0.0",
          tools: tools,
        });
        _proxyServers[serverName] = mcpServer;
      }
    }
  }

  function createToolHandler(serverName, toolName) {
    return function (args) {
      return new Promise(function (resolve, reject) {
        var extWs = getExtensionWs();
        if (!extWs || extWs.readyState !== 1) {
          reject(new Error("Browser extension not connected. Cannot reach MCP server: " + serverName));
          return;
        }

        var callId = "mc_" + Date.now() + "_" + crypto.randomUUID().slice(0, 8);

        var timer = setTimeout(function () {
          delete _pendingCalls[callId];
          reject(new Error("MCP tool call timed out after " + (TOOL_TIMEOUT_MS / 1000) + "s"));
        }, TOOL_TIMEOUT_MS);

        _pendingCalls[callId] = { resolve: resolve, reject: reject, timer: timer };

        sendTo(extWs, {
          type: "mcp_tool_call",
          callId: callId,
          server: serverName,
          method: "tools/call",
          params: { name: toolName, arguments: args },
        });
      });
    };
  }

  // Build a Zod shape from MCP JSON Schema inputSchema
  function buildZodShape(z, inputSchema) {
    if (!inputSchema || !inputSchema.properties) return {};
    var shape = {};
    var props = inputSchema.properties;
    var required = inputSchema.required || [];
    var keys = Object.keys(props);

    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var p = props[k];
      var field;

      if (p.type === "number" || p.type === "integer") {
        field = z.number();
      } else if (p.type === "boolean") {
        field = z.boolean();
      } else if (p.type === "array") {
        field = z.array(z.any());
      } else if (p.type === "object") {
        field = z.record(z.any());
      } else if (p.enum) {
        field = z.enum(p.enum);
      } else {
        field = z.string();
      }

      if (p.description) field = field.describe(p.description);
      if (required.indexOf(k) === -1) field = field.optional();
      shape[k] = field;
    }
    return shape;
  }

  // ---------- State Broadcasting ----------

  function broadcastMcpState() {
    var state = buildMcpState();
    send(state);
  }

  function sendConnectionState(ws) {
    sendTo(ws, buildMcpState());
  }

  function buildMcpState() {
    var enabledList = getEnabledMcpServers() || [];
    var servers = [];
    var names = Object.keys(_availableServers);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      var info = _availableServers[name];
      servers.push({
        name: name,
        transport: info.transport,
        toolCount: (info.tools || []).length,
        extensionEnabled: info.enabled,
        projectEnabled: enabledList.indexOf(name) !== -1,
      });
    }
    return {
      type: "mcp_servers_state",
      servers: servers,
    };
  }

  // ---------- Public API ----------

  function getMcpServers() {
    return _proxyServers;
  }

  function cancelAllPending() {
    var ids = Object.keys(_pendingCalls);
    for (var i = 0; i < ids.length; i++) {
      var pending = _pendingCalls[ids[i]];
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error("MCP bridge disconnected"));
    }
    _pendingCalls = {};
  }

  function handleExtensionDisconnect() {
    cancelAllPending();
    _availableServers = {};
    _proxyServers = {};
    broadcastMcpState();
  }

  return {
    handleMcpMessage: handleMcpMessage,
    getMcpServers: getMcpServers,
    sendConnectionState: sendConnectionState,
    handleExtensionDisconnect: handleExtensionDisconnect,
  };
}

module.exports = { attachMcp: attachMcp };
