#!/usr/bin/env node
// Browser MCP Server for Clay
// Provides browser automation tools to Claude via MCP protocol.
// Communicates with Clay server via HTTP, which bridges to the Chrome extension.
//
// Environment variables:
//   CLAY_PORT     - Clay server port (default 2633)
//   CLAY_SLUG     - Project slug
//   CLAY_EXT_TOKEN - Auth token for extension bridge
//   CLAY_TLS      - "1" if Clay server uses HTTPS

var Server = require("@modelcontextprotocol/sdk/server/index.js").Server;
var StdioServerTransport = require("@modelcontextprotocol/sdk/server/stdio.js").StdioServerTransport;
var types = require("@modelcontextprotocol/sdk/types.js");
var http = require("http");
var https = require("https");

var CLAY_PORT = process.env.CLAY_PORT || "2633";
var CLAY_SLUG = process.env.CLAY_SLUG || "";
var CLAY_TOKEN = process.env.CLAY_EXT_TOKEN || "";
var CLAY_TLS = process.env.CLAY_TLS === "1";

// ---------------------------------------------------------------------------
// HTTP bridge to Clay server
// ---------------------------------------------------------------------------

function callExtension(command, args, timeout) {
  return new Promise(function (resolve, reject) {
    var postData = JSON.stringify({ command: command, args: args || {}, token: CLAY_TOKEN });
    var mod = CLAY_TLS ? https : http;
    var req = mod.request(
      {
        hostname: "127.0.0.1",
        port: parseInt(CLAY_PORT, 10),
        path: "/p/" + CLAY_SLUG + "/ext-command",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        rejectUnauthorized: false,
      },
      function (res) {
        var body = "";
        res.on("data", function (chunk) { body += chunk; });
        res.on("end", function () {
          try {
            var parsed = JSON.parse(body);
            if (parsed.error) return reject(new Error(parsed.error));
            resolve(parsed.result || parsed);
          } catch (e) {
            reject(new Error("Bad response: " + body.substring(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    if (timeout) {
      req.setTimeout(timeout, function () {
        req.destroy();
        reject(new Error("Request timed out after " + timeout + "ms"));
      });
    }
    req.write(postData);
    req.end();
  });
}

// Ensure inject.js is loaded in a tab (best-effort)
function ensureInjected(tabId) {
  return callExtension("tab_inject", { tabId: tabId }).catch(function () {});
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

var TOOLS = [
  {
    name: "browser_list_tabs",
    description: "List all open browser tabs with their IDs, URLs, and titles",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_open",
    description: "Open a new browser tab and return its tab ID",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to open" },
        active: { type: "boolean", description: "Activate the tab (default true)" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_close",
    description: "Close a browser tab",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID to close" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_navigate",
    description: "Navigate a tab to a new URL",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["tabId", "url"],
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of a browser tab (full viewport or a specific element)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector to capture a specific element (optional, captures full viewport if omitted)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_console",
    description: "Read captured console logs from a tab (log, warn, error, info). Requires inject.js to have been loaded.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_network",
    description: "Read captured network requests (fetch/XHR) from a tab. Only shows requests made after inject.js was loaded.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_read_page",
    description: "Read page text content (innerText). Optionally read only a specific element's text.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector to read specific element (optional, reads full body if omitted)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_dom",
    description: "Get a simplified DOM tree (tag, id, class, children) for structural analysis. Not full HTML.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector for root element (default body)" },
        depth: { type: "number", description: "Max tree depth (default 3)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_styles",
    description: "Get computed styles of an element (display, position, size, colors, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector" },
      },
      required: ["tabId", "selector"],
    },
  },
  {
    name: "browser_storage",
    description: "Read browser storage (localStorage, sessionStorage, or cookies)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        type: { type: "string", enum: ["local", "session", "cookie"], description: "Storage type (default local)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_evaluate",
    description: "Execute arbitrary JavaScript in the page context and return the result",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        script: { type: "string", description: "JavaScript expression or IIFE to evaluate" },
      },
      required: ["tabId", "script"],
    },
  },
  {
    name: "browser_click",
    description: "Click an element on the page",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector of the element to click" },
      },
      required: ["tabId", "selector"],
    },
  },
  {
    name: "browser_type",
    description: "Type text into an input element (sets value and dispatches input/change events)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector of the input element" },
        text: { type: "string", description: "Text to type" },
      },
      required: ["tabId", "selector", "text"],
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or scroll a specific element into view",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector to scroll into view (optional)" },
        x: { type: "number", description: "Horizontal scroll position (optional, used if no selector)" },
        y: { type: "number", description: "Vertical scroll position (optional, used if no selector)" },
      },
      required: ["tabId"],
    },
  },
  {
    name: "browser_wait",
    description: "Wait for an element matching a CSS selector to appear in the DOM",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        selector: { type: "string", description: "CSS selector to wait for" },
        timeout: { type: "number", description: "Timeout in ms (default 5000)" },
      },
      required: ["tabId", "selector"],
    },
  },
  {
    name: "browser_wait_navigation",
    description: "Wait for page navigation to complete (URL change + load event)",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab ID" },
        timeout: { type: "number", description: "Timeout in ms (default 10000)" },
      },
      required: ["tabId"],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

var HANDLERS = {};

HANDLERS.browser_list_tabs = function (args) {
  return callExtension("list_tabs", {}).then(function (result) {
    var tabs = result.tabs || result || [];
    return { content: [{ type: "text", text: JSON.stringify(tabs, null, 2) }] };
  });
};

HANDLERS.browser_open = function (args) {
  return callExtension("tab_open", { url: args.url, active: args.active !== false }).then(function (result) {
    return { content: [{ type: "text", text: "Opened tab " + (result.id || "unknown") + ": " + args.url }] };
  });
};

HANDLERS.browser_close = function (args) {
  return callExtension("tab_close", { tabId: args.tabId }).then(function () {
    return { content: [{ type: "text", text: "Closed tab " + args.tabId }] };
  });
};

HANDLERS.browser_navigate = function (args) {
  return callExtension("tab_navigate", { tabId: args.tabId, url: args.url }).then(function () {
    return { content: [{ type: "text", text: "Navigated tab " + args.tabId + " to " + args.url }] };
  });
};

HANDLERS.browser_screenshot = function (args) {
  var extArgs = { tabId: args.tabId };
  if (args.selector) extArgs.selector = args.selector;
  return callExtension("tab_screenshot", extArgs, 10000).then(function (result) {
    if (!result || !result.image) throw new Error("Screenshot failed");
    return {
      content: [
        { type: "image", data: result.image, mimeType: "image/png" },
        { type: "text", text: "Screenshot captured" + (args.selector ? " (selector: " + args.selector + ")" : " (full viewport)") },
      ],
    };
  });
};

HANDLERS.browser_console = function (args) {
  return ensureInjected(args.tabId).then(function () {
    return callExtension("tab_console", { tabId: args.tabId });
  }).then(function (result) {
    var logs = [];
    try {
      logs = typeof result.logs === "string" ? JSON.parse(result.logs) : (result.logs || []);
    } catch (e) {}
    if (logs.length === 0) return { content: [{ type: "text", text: "No console output captured" }] };
    var lines = logs.map(function (entry) {
      var ts = entry.ts ? new Date(entry.ts).toTimeString().slice(0, 8) : "";
      return "[" + ts + " " + (entry.level || "log").toUpperCase() + "] " + (entry.text || "");
    });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });
};

HANDLERS.browser_network = function (args) {
  return ensureInjected(args.tabId).then(function () {
    return callExtension("tab_network", { tabId: args.tabId });
  }).then(function (result) {
    var reqs = [];
    try {
      reqs = typeof result.network === "string" ? JSON.parse(result.network) : (result.network || []);
    } catch (e) {}
    if (reqs.length === 0) return { content: [{ type: "text", text: "No network requests captured" }] };
    var lines = reqs.map(function (r) {
      var line = (r.method || "GET") + " " + (r.url || "") + " " + (r.status || 0) + " " + (r.duration || 0) + "ms";
      if (r.error) line += " [" + r.error + "]";
      return line;
    });
    return { content: [{ type: "text", text: lines.join("\n") }] };
  });
};

HANDLERS.browser_read_page = function (args) {
  if (args.selector) {
    // Use tab_evaluate to read specific element
    var script = "(function() { var el = document.querySelector(" + JSON.stringify(args.selector) + "); if (!el) return ''; var t = el.innerText; return t.length > 32768 ? t.substring(0, 32768) : t; })()";
    return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
      var text = result.value || "";
      if (!text) return { content: [{ type: "text", text: "Element not found or empty: " + args.selector }] };
      return { content: [{ type: "text", text: text }] };
    });
  }
  return callExtension("tab_page_text", { tabId: args.tabId }).then(function (result) {
    var text = result.text || "";
    if (!text) return { content: [{ type: "text", text: "Page has no text content" }] };
    return { content: [{ type: "text", text: text }] };
  });
};

HANDLERS.browser_dom = function (args) {
  var selector = args.selector ? JSON.stringify(args.selector) : '"body"';
  var depth = args.depth || 3;
  var script = "(function() {" +
    "function walk(el, d, max) {" +
    "  if (!el || d > max) return null;" +
    "  var n = { tag: el.tagName.toLowerCase() };" +
    "  if (el.id) n.id = el.id;" +
    "  if (el.className && typeof el.className === 'string') { var c = el.className.trim(); if (c) n.class = c; }" +
    "  if (el.children.length > 0 && d < max) {" +
    "    n.children = [];" +
    "    for (var i = 0; i < el.children.length; i++) {" +
    "      var child = walk(el.children[i], d + 1, max);" +
    "      if (child) n.children.push(child);" +
    "    }" +
    "  } else if (el.children.length > 0) {" +
    "    n.childCount = el.children.length;" +
    "  }" +
    "  if (el.children.length === 0 && el.textContent) {" +
    "    var t = el.textContent.trim();" +
    "    if (t.length > 100) t = t.substring(0, 100) + '...';" +
    "    if (t) n.text = t;" +
    "  }" +
    "  return n;" +
    "}" +
    "var root = document.querySelector(" + selector + ") || document.body;" +
    "return JSON.stringify(walk(root, 0, " + depth + "), null, 2);" +
    "})()";
  return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
    var text = result.value || "null";
    return { content: [{ type: "text", text: text }] };
  });
};

HANDLERS.browser_styles = function (args) {
  var script = "(function() {" +
    "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
    "if (!el) return JSON.stringify({ error: 'Element not found' });" +
    "var cs = window.getComputedStyle(el);" +
    "var props = ['display','visibility','opacity','position','top','right','bottom','left'," +
    "'width','height','minWidth','minHeight','maxWidth','maxHeight'," +
    "'margin','padding','border','borderRadius'," +
    "'color','backgroundColor','fontSize','fontFamily','fontWeight'," +
    "'overflow','zIndex','transform','transition','boxShadow','cursor'];" +
    "var result = {};" +
    "for (var i = 0; i < props.length; i++) { result[props[i]] = cs[props[i]]; }" +
    "result.boundingRect = el.getBoundingClientRect().toJSON();" +
    "return JSON.stringify(result, null, 2);" +
    "})()";
  return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
    return { content: [{ type: "text", text: result.value || "null" }] };
  });
};

HANDLERS.browser_storage = function (args) {
  var storageType = args.type || "local";
  var script;
  if (storageType === "cookie") {
    script = "JSON.stringify(document.cookie.split('; ').reduce(function(o, c) { var p = c.split('='); o[p[0]] = decodeURIComponent(p.slice(1).join('=')); return o; }, {}), null, 2)";
  } else if (storageType === "session") {
    script = "(function() { var o = {}; for (var i = 0; i < sessionStorage.length; i++) { var k = sessionStorage.key(i); o[k] = sessionStorage.getItem(k); } return JSON.stringify(o, null, 2); })()";
  } else {
    script = "(function() { var o = {}; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(o, null, 2); })()";
  }
  return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
    return { content: [{ type: "text", text: result.value || "{}" }] };
  });
};

HANDLERS.browser_evaluate = function (args) {
  return callExtension("tab_evaluate", { tabId: args.tabId, script: args.script }).then(function (result) {
    if (result.error) throw new Error(result.error);
    var text = typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2);
    return { content: [{ type: "text", text: text || "(undefined)" }] };
  });
};

HANDLERS.browser_click = function (args) {
  var script = "(function() {" +
    "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
    "if (!el) return 'Element not found: " + args.selector.replace(/'/g, "\\'") + "';" +
    "el.scrollIntoView({ block: 'center', behavior: 'instant' });" +
    "el.click();" +
    "return 'Clicked: " + args.selector.replace(/'/g, "\\'") + "';" +
    "})()";
  return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
    return { content: [{ type: "text", text: result.value || "Click executed" }] };
  });
};

HANDLERS.browser_type = function (args) {
  var script = "(function() {" +
    "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
    "if (!el) return 'Element not found: " + args.selector.replace(/'/g, "\\'") + "';" +
    "el.focus();" +
    "var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');" +
    "if (nativeSetter && nativeSetter.set) { nativeSetter.set.call(el, " + JSON.stringify(args.text) + "); }" +
    "else { el.value = " + JSON.stringify(args.text) + "; }" +
    "el.dispatchEvent(new Event('input', { bubbles: true }));" +
    "el.dispatchEvent(new Event('change', { bubbles: true }));" +
    "return 'Typed into: " + args.selector.replace(/'/g, "\\'") + "';" +
    "})()";
  return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
    return { content: [{ type: "text", text: result.value || "Type executed" }] };
  });
};

HANDLERS.browser_scroll = function (args) {
  var script;
  if (args.selector) {
    script = "(function() {" +
      "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
      "if (!el) return 'Element not found';" +
      "el.scrollIntoView({ block: 'center', behavior: 'smooth' });" +
      "return 'Scrolled to: " + args.selector.replace(/'/g, "\\'") + "';" +
      "})()";
  } else {
    var x = args.x || 0;
    var y = args.y || 0;
    script = "(function() { window.scrollTo(" + x + ", " + y + "); return 'Scrolled to (" + x + ", " + y + ")'; })()";
  }
  return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
    return { content: [{ type: "text", text: result.value || "Scroll executed" }] };
  });
};

HANDLERS.browser_wait = function (args) {
  var timeout = args.timeout || 5000;
  // Build a script that returns a promise-like result via polling
  // Since tab_evaluate is synchronous eval, we use a polling approach via separate calls
  var script = "(function() {" +
    "var el = document.querySelector(" + JSON.stringify(args.selector) + ");" +
    "if (el) return JSON.stringify({ found: true, tag: el.tagName.toLowerCase() });" +
    "return JSON.stringify({ found: false });" +
    "})()";

  var startTime = Date.now();
  function poll() {
    return callExtension("tab_evaluate", { tabId: args.tabId, script: script }).then(function (result) {
      var parsed = {};
      try { parsed = JSON.parse(result.value || "{}"); } catch (e) {}
      if (parsed.found) {
        return { content: [{ type: "text", text: "Element found: " + args.selector + " (" + parsed.tag + ")" }] };
      }
      if (Date.now() - startTime >= timeout) {
        throw new Error("Timeout waiting for element: " + args.selector + " (" + timeout + "ms)");
      }
      // Poll every 300ms
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(poll()); }, 300);
      });
    });
  }
  return poll();
};

HANDLERS.browser_wait_navigation = function (args) {
  var timeout = args.timeout || 10000;
  return callExtension("tab_wait_navigation", { tabId: args.tabId, timeout: timeout }, timeout + 3000).then(function (result) {
    if (result.error) throw new Error(result.error);
    return { content: [{ type: "text", text: "Navigation complete: " + (result.url || "unknown URL") }] };
  });
};

// ---------------------------------------------------------------------------
// MCP server setup
// ---------------------------------------------------------------------------

var server = new Server(
  { name: "clay-browser", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(types.ListToolsRequestSchema, function () {
  return Promise.resolve({ tools: TOOLS });
});

server.setRequestHandler(types.CallToolRequestSchema, function (request) {
  var name = request.params.name;
  var args = request.params.arguments || {};
  var handler = HANDLERS[name];
  if (!handler) {
    return Promise.resolve({
      content: [{ type: "text", text: "Unknown tool: " + name }],
      isError: true,
    });
  }
  return handler(args).catch(function (err) {
    return {
      content: [{ type: "text", text: "Error: " + (err.message || String(err)) }],
      isError: true,
    };
  });
});

// Start
var transport = new StdioServerTransport();
server.connect(transport).catch(function (err) {
  process.stderr.write("MCP server error: " + err.message + "\n");
  process.exit(1);
});
