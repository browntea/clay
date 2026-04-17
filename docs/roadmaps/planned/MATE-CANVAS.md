# Mate Canvas

> The V in Mate MVC. Each Mate owns visual canvases that display data from its Datastore. Canvases live in the Mate, visible in DM. Users promote canvases to Home Hub for an at-a-glance dashboard.

**Created**: 2026-04-17
**Status**: Planning

---

## Architecture: Mate MVC

```
M  Mate Datastore    Per-Mate SQLite DB. Structured data persistence.
V  Mate Canvas       Visual templates owned by the Mate. Renders Datastore data.
C  Mate AI           Collects data, writes to Datastore, creates/updates Canvases.
```

The Mate is a self-contained unit: it owns its data, its views, and the intelligence to manage both. Home Hub is not a separate system. It is a curated collection of promoted canvases from across the user's Mates.

---

## How It Works

### 1. Mate Creates a Canvas

During conversation, the Mate creates a canvas using an SDK tool:

```
User: "Show me my monthly spending trend"

Moneta (Mate):
  1. Reads from Datastore: clay_data_find("expenses", {})
  2. Creates canvas: clay_canvas_create({
       title: "Monthly Spending Trend",
       html: "<div class='clay-chart-container'>...</div>",
       data_bindings: { expenses: { collection: "expenses" } }
     })
```

The canvas appears in the Mate's DM view.

### 2. Canvas Lives in the Mate

Each canvas is stored with the Mate:

```
~/.clay/mates/{userId}/{mateId}/canvases/{canvasId}.json
```

```json
{
  "id": "cv_abc123",
  "title": "Monthly Spending Trend",
  "size": "medium",
  "html": "<div class='clay-stat-card'>...</div>",
  "data_bindings": {
    "expenses": { "collection": "expenses", "query": {} }
  },
  "created_at": 1712700000,
  "updated_at": 1712700000
}
```

Canvases are visible when chatting with the Mate (in DM sidebar or inline).

### 3. Promote to Home Hub

User sees a useful canvas in a Mate DM and promotes it:

```
Canvas header: [Monthly Spending Trend]  [Pin to Home Hub]
```

Home Hub layout stores references, not copies:

```json
{
  "widgets": [
    { "mateId": "mate_moneta", "canvasId": "cv_abc123", "position": { "col": 0, "row": 0 } },
    { "mateId": "mate_weather", "canvasId": "cv_def456", "position": { "col": 2, "row": 0 } }
  ]
}
```

Home Hub fetches canvas HTML + data from the owning Mate's datastore at render time. When the Mate updates its data, the Home Hub canvas updates too.

### 4. Mate Updates Canvas

The Mate can update a canvas anytime (during conversation, via schedule, via Ralph loop):

```
Moneta (scheduled daily):
  1. Fetches bank data
  2. Updates Datastore: clay_data_insert("expenses", {...})
  3. Canvas auto-refreshes (data bindings pull new data)
```

Or the Mate can update the canvas HTML itself:

```
clay_canvas_update({ canvas_id: "cv_abc123", html: "..." })
```

---

## Canvas Rendering

### Restricted HTML (same as HOME-HUB widget spec)

Canvases use restricted HTML with Clay CSS classes. No scripts, no external resources. Server-side sanitization.

**Allowed**: `div, span, p, h1-h4, ul, ol, li, table, thead, tbody, tr, th, td, img, svg, canvas, strong, em, code, pre, br, hr`

**Blocked**: `script, style, link, iframe, form, input`, event handlers, `javascript:` URLs

### Clay CSS Classes

All `clay-*` prefixed classes for consistent theming:

```css
.clay-stat-card, .clay-stat-value, .clay-stat-label, .clay-stat-delta
.clay-list, .clay-list-item, .clay-list-label, .clay-list-value
.clay-table, .clay-chart-container
.clay-badge, .clay-progress, .clay-progress-fill
.clay-row, .clay-col, .clay-grid-2, .clay-grid-3
.clay-text-sm/md/lg, .clay-text-muted/success/warning/danger
```

Auto-respects light/dark theme via CSS variables.

### Data Binding

```html
<div class="clay-stat-value" data-bind="expenses.total"></div>
```

The renderer:
1. Parses `data-bind` attributes
2. Fetches referenced collections from the Mate's Datastore
3. Injects values into DOM
4. Re-renders on `mate_data_change` WebSocket messages

---

## SDK Tools

```
Tool: clay_canvas_create
  title: "Monthly Spending Trend"
  size: "small" | "medium" | "large"
  html: "<div class='clay-stat-card'>...</div>"
  data_bindings: { expenses: { collection: "expenses", query: {} } }

Tool: clay_canvas_update
  canvas_id: "cv_abc123"
  title: "..."           (optional)
  html: "..."            (optional)
  data_bindings: {...}   (optional)

Tool: clay_canvas_delete
  canvas_id: "cv_abc123"

Tool: clay_canvas_list
  (lists all canvases owned by this Mate)
```

---

## Where Canvases Appear

| Location | What shows | How |
|----------|-----------|-----|
| Mate DM | All canvases owned by this Mate | Sidebar panel or inline in chat |
| Home Hub | Only promoted canvases | User picks which to pin |
| Mate Settings | Canvas list with edit/delete | Management UI |

---

## Home Hub Simplification

With Mate Canvas, Home Hub becomes:

```
Home Hub = Greeting + Notifications + Promoted Canvases
```

No widget system. No widget picker. No widget CRUD. Just:
- A list of canvas references (mateId + canvasId)
- A grid layout with drag-and-drop reorder
- Promote/demote actions

The complexity lives in the Mate (where it belongs). Home Hub is just a view aggregator.

---

## Implementation Order

1. Canvas storage (JSON files per Mate)
2. SDK tools (create/update/delete/list)
3. Canvas renderer (restricted HTML + data binding)
4. `clay-widgets.css` class library
5. Canvas display in Mate DM sidebar
6. Promote/demote to Home Hub
7. Home Hub grid layout with promoted canvases

---

## Dependencies

```
Mate Datastore (M) ──> Mate Canvas (V) ──> Home Hub (aggregator)
```

Mate Datastore must exist first. Canvas reads from it.

---

## Open Questions

1. **Canvas size limits?** Max HTML size per canvas. Recommendation: 50KB.
2. **How many canvases per Mate?** Recommendation: No hard limit, but UI shows latest 20 in sidebar.
3. **Can a canvas reference another Mate's data?** Recommendation: No. Keep it scoped. One Mate, one Datastore, one set of canvases.
4. **Live charts?** Allow `<canvas>` element for chart.js or similar? Recommendation: Yes, inject a lightweight chart lib into the sandbox.
5. **Canvas versioning?** Recommendation: No. Mate overwrites. Old versions not kept.
6. **Can users create canvases manually?** Recommendation: Defer. Mates create them. Users can edit HTML in settings if they want.
