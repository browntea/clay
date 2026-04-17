# Bug: Browser Tab Context Source Not Injected Into Messages

**Created**: 2026-04-17
**Severity**: High (core feature broken)

---

## Symptom

User adds a browser tab as a context source in the picker. When sending a message, the tab content (page text, console logs, network, screenshot) is NOT injected into the message context. The AI never sees the tab data.

## Root Cause

`requestTabContext(ws, tabId)` in `project-user-message.js` line 502 passes the **message sender's WebSocket** to `sendExtensionCommand`. But `sendExtensionCommand` sends an `extension_command` message to that WebSocket, expecting the Chrome extension to handle it.

The Chrome extension only lives on the client that has it installed. If the WS connection has been recycled, or in multi-client scenarios, the command goes to the wrong recipient and times out silently (3s timeout, resolves to `null`).

The fix: `requestTabContext` should always use `browserState._extensionWs` (the tracked extension WebSocket), not the caller's `ws`.

## Files to Change

### 1. `lib/project.js` (line ~261)

**Current:**
```js
function requestTabContext(ws, tabId) {
  return sendExtensionCommand(ws, "tab_inject", { tabId: tabId })
```

**Fix:** Use `browserState._extensionWs` instead of the passed `ws` parameter. If no extension is connected, return `null` immediately instead of timing out.

```js
function requestTabContext(tabId) {
  if (!browserState._extensionWs || browserState._extensionWs.readyState !== 1) {
    return Promise.resolve(null);
  }
  var extWs = browserState._extensionWs;
  return sendExtensionCommand(extWs, "tab_inject", { tabId: tabId })
    .then(function() {}, function() {})
    .then(function() {
      return Promise.all([
        sendExtensionCommand(extWs, "tab_console", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_network", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_page_text", { tabId: tabId }),
        sendExtensionCommand(extWs, "tab_screenshot", { tabId: tabId })
      ]);
    })
    .then(function(results) {
      return { console: results[0], network: results[1], pageText: results[2], screenshot: results[3] };
    })
    .catch(function() { return null; });
}
```

### 2. `lib/project-user-message.js` (line ~502)

**Current:**
```js
return requestTabContext(ws, tabId);
```

**Fix:** Remove `ws` parameter:
```js
return requestTabContext(tabId);
```

### 3. All other callers of `requestTabContext`

Search for `requestTabContext` across the codebase and remove the `ws` parameter from all call sites.

### 4. `lib/project.js` - function signature in ctx

Update `requestTabContext` reference passed to `attachUserMessage` ctx. The function no longer takes `ws` as first arg.

## Verification

1. Open Clay, connect Chrome extension
2. Open a browser tab (e.g., any web page)
3. Add the tab as a context source in the picker
4. Send a message like "what's on my browser tab?"
5. The AI should see and describe the page content, console logs, and/or screenshot

## Notes

- This is likely an old bug, not caused by the email/context-sources-per-session changes
- The `sendExtensionCommandAny` function in project.js already correctly uses `browserState._extensionWs` for MCP browser tools. Only `requestTabContext` has this issue.
