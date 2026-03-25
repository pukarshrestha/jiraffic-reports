Design

Description:
This MD file is an instruction file for this project to reference Atlassian's design system, color palette, and shared UI patterns.

Instruction:

- Always use the below reference files using Figma MCP to build layouts and components.
- If something is new, please ask me before implementing it yourself.

For Design Tokens, Colour and Typography and Grids, use this:

ADS Foundations: https://www.figma.com/design/NYtM0PblN2mlM9O5EJrdpq/ADS-Foundations--Community-?node-id=14439-10399&t=qhBFv5mivutBx6hT-1

For Components, use this:

https://www.figma.com/design/RIGSyaS2jlHwVyRtq2HJ75/ADS-Components--Community-?node-id=70387-7994&t=L34LMT3D27X284iS-1

For Icons, use this:

https://www.figma.com/design/NSdVGUH5b2hbS2hwy7hVmz/ADS-Iconography--Community-?node-id=0-1&t=H8c6xthJuHMJ03JE-1

---

## Common UI Patterns

The following patterns are established across the app (Work Log, Time in Lane, etc.) and should be reused consistently.

### 1. Filter Bar (`wl-filter-bar`)

An inline bar at the top of a report page, split into left (pills) and right (action buttons).

**Structure:**
```html
<div class="wl-filter-bar">
  <div class="wl-filter-bar-left">
    <!-- pill wrappers here -->
  </div>
  <div class="wl-filter-bar-right">
    <!-- export / action buttons here -->
  </div>
</div>
```

**CSS:** `display: flex; align-items: center; justify-content: space-between; gap: var(--ds-space-150); padding: var(--ds-space-100) 0; margin-bottom: var(--ds-space-200);` — **No border-bottom.**

---

### 2. Pill + Popover (`wl-filter-pill` → `wl-popover`)

Filter pills act as dropdown triggers. Each pill lives inside a `wl-pill-wrapper` (relative positioned) with its popover as a sibling.

**Active State:** Add `.wl-pill-active` to the pill button **only** when the popover is visible. Remove it when closed. Uses `rgba(76, 154, 255, 0.08)` background, `var(--ds-border-brand)` border, `var(--ds-text-brand)` text.

**Popover:** Absolute positioned below the pill (`top: calc(100% + 6px)`), `min-width: 300px`, with `var(--ds-surface-overlay)` background, `var(--ds-shadow-overlay)` box shadow, and a 0.15s fade-in animation.

**Close logic:** Use `closeAllPopovers()` to close all before opening a new one. Outside clicks close via a `document.addEventListener('click')` handler.

---

### 3. User Search Popover

Inside a pill popover, provides:
- `wl-popover-header` — uppercase label "Select Users"
- `wl-popover-search` — search input with magnifying glass icon
- `wl-popover-results` — dropdown showing user results (with avatars) and group results
- `wl-selected-list` — list of selected users with ×-remove buttons

**User avatars:** Use `48x48` URL from Jira's `avatarUrls` object. Render as `<img>` with `border-radius: 50%`. Fallback: `<span class="avatar avatar-xs">` with first initial.

---

### 4. Date Popover (Month / Custom)

Two modes toggled via `wl-date-mode-btn`:
- **Month mode:** Year navigation (‹ year ›) + 4×3 month grid (`wl-month-grid`)
- **Custom mode:** From / To date inputs (`wl-date-custom-panel`)

Selecting a month auto-closes the popover and triggers regeneration.

---

### 5. User Tabs (`wl-tabs`)

Used when multiple users are selected. Each user gets their own tab, plus an "All Users" tab at the end.

**Structure:**
```html
<div class="wl-tabs">
  <button class="wl-tab active" data-tab="userId1">
    <img class="wl-tab-avatar" /> <span>Name</span>
  </button>
  <button class="wl-tab" data-tab="all">
    <svg><!-- people icon --></svg> <span>All Users</span>
  </button>
</div>
<div class="wl-tab-panel active" data-panel="userId1">...</div>
<div class="wl-tab-panel" data-panel="all">...</div>
```

**Switching:** Toggle `.active` on tab buttons and panels via click handler.

---

### 6. Loading Screen (`loading-screen`)

Shows a centered spinner + progress text during data fetching.

```html
<div class="loading-screen">
  <div class="spinner spinner-lg"></div>
  <p class="wl-loading-progress">Fetching data...</p>
</div>
```

**Progress updates:** Query `.wl-loading-progress` and update `textContent` as batches complete, e.g. `"Processing issues (15/30)..."`.

---

### 7. Excel Export (`export-excel-btn`)

A `btn btn-default-outline btn-sm` button in `wl-filter-bar-right`. Initially hidden via `d-none`, shown after report data is available.

**Implementation:**
1. Dynamically import `exceljs` and `file-saver` only when export is clicked
2. Build workbook with styled title row, header row, and data rows
3. `saveAs()` with `.xlsx` blob
4. Show `showToast('success', ...)` confirmation

---

### 8. Site Group Title (`wl-site-group-title`)

Used when data spans multiple Jira sites. Uppercase label with semibold weight.

**CSS:** `text-transform: uppercase; letter-spacing: 0.05em; padding: var(--ds-space-100) 0;` — **No border-bottom**, equal top/bottom padding.

---

### 9. Auto-Regeneration

Reports auto-generate on any filter change using a debounced `scheduleRegenerate()` function (500ms). No manual "Generate" button.

```js
function scheduleRegenerate() {
  clearTimeout(regenTimeout);
  regenTimeout = setTimeout(() => {
    if (selectedUsers.length > 0) generateReport();
  }, 500);
}
```

---

### 10. Avatar Rendering

- **Jira user avatars:** Fetch from `user.avatarUrls['48x48']` or `savedUser.avatarUrl`
- **Display:** `<img>` with explicit size, `border-radius: 50%`, `object-fit: cover`
- **Fallback:** `<span class="avatar avatar-xs">` with first character of displayName, uppercase
- **Common sizes:** 20px (tabs), 24px (popover lists, search results), 28px (standalone user references)