# Fjord UI design

Figma: <https://www.figma.com/design/fWkyK4QNyMaEM4K65JwHf2> (Foundations, Components, Screens). Variable/style ids: [figma-ledger.json](figma-ledger.json).
Code: shared tokens/base in `extensions/fjord/ui/` (`tokens.css`, `base.css`, `icons.js`), used by every module.

## Benchmark (what we borrowed, what we avoided)

Sources were thin and mostly forum/vendor posts, so treat them as direction, not proof: Opera forums (Opera One launch feedback), SupaSidebar / SuperchargeBrowser / Tabbit comparisons (Arc, Zen, Vivaldi, Edge, Brave), TechCrunch/WebDesignerDepot on Opera's sidebar history. No primary design docs were found.

| Pattern | Seen in | Fjord decision |
|---|---|---|
| A narrow left **rail** is the primary navigation; the sidebar holds saved links and spaces, not just open tabs | Arc, Zen, Vivaldi, Opera | Rail of pinned sites (top) + built-in tools (bottom), 48 px collapsed / 168 px expanded |
| Sidebar on every page annoyed users (Opera 60) | Opera forums | It is a **side panel**: opt-in, not injected into pages |
| Speed Dial vs Workspaces vs Tab Islands overlapped and confused users; the dial could not follow a workspace | Opera One feedback | One concept per surface: workspaces = tab groups, rail = pinned sites + tools, **speed dial follows the workspace** (chips on the new tab) |
| "Slot machine" workspace-switch animation was too slow | Opera One feedback | All motion ≤ 120 ms, off under `prefers-reduced-motion` |
| Collapsed items should still be recognisable | Opera One feedback | Collapsed rail keeps real favicons / letter avatars, never anonymous dots |
| Density options are valued | Vivaldi | Two rail states now; density setting is a later task |

## Principles
1. Rail-first, side-panel-based. 2. One concept per surface. 3. Fast, optional motion. 4. Same tokens everywhere (light/dark follow the OS). 5. Korean-first copy, short labels.

## Tokens (see `ui/tokens.css`)
Palette: Nordic slate neutrals + glacier indigo (`accent/primary` #6366F1 / dark #818CF8) with teal as secondary; semantic Light/Dark sets (18 colors), space 2–40, radius 6/8/12/16/full, sizes (rail 48/168, controls 28/34, icon 20, tile height 112).
Type: Noto Sans KR in Figma (Pretendard is not in Figma's font list); CSS stack `Pretendard, "Noto Sans KR", "Malgun Gothic", system-ui`. Ramp: Display 44/52 light, Title/Page 22/30 bold, Title/Section 16/24, Body 14/22, Label 13/18 medium, Caption 12/16, Micro 11/14.
Starter-plan Figma allows one mode per collection, so Light and Dark are separate collections (`Color Light`, `Color Dark`) with identical variable names.

## Components → code
| Figma component | Code |
|---|---|
| RailButton (Collapsed/Expanded × Default/Hover/Active) | `.rail-btn` in `modules/sidebar/panel.css` |
| SpeedDialTile (Default/Hover) | `.tile` in `modules/newtab/newtab.css` |
| WorkspaceRow (Default/Active) | `.fj-row` / `.fj-row--active` in `ui/base.css` |
| ToggleRow | `.fj-toggle` in `ui/base.css` |
| Button (Primary/Secondary) | `.fj-btn`, `.fj-btn--primary` |
| SearchField | `#search` / `#q` in `modules/newtab/newtab.css` |

## Screens
Built in Figma: side panel collapsed + expanded (Claude page). Built directly in code (Figma MCP limit on the Starter plan was reached before these): workspaces page, ad blocker page (the stand-alone blocker's popup, re-themed with our tokens by `scripts/sync-adblock.mjs`), speed-dial new tab with workspace chips, options, Claude install page.
Preview any page without the browser: `node scripts/preview-server.mjs` → `http://127.0.0.1:5199/modules/sidebar/panel.html?active=@workspaces&collapsed=0` (an in-memory `chrome.*` stub is injected).

## Known gaps
- Figma lacks the workspaces / ad blocker / new tab / dark screens (tool quota); the code is the reference for those.
- The ad blocker popup text is still English (upstream repo).
- App icon is still the placeholder mark.
