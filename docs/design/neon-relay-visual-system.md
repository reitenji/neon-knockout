# Neon Relay Visual System

## Source of truth

The approved product behavior remains `docs/superpowers/specs/2026-08-28-neon-relay-design.md`. These generated concepts lock the visual interpretation:

- `docs/design/concepts/landing.png`
- `docs/design/concepts/lobby.png`
- `docs/design/concepts/match.png`
- `docs/design/concepts/result.png`

The concepts are layout, hierarchy, material, palette, typography, and density references. Generated example names and scores are not product data; implementation always renders the canonical room/match state.

## Direction

Neon Relay is a quiet industrial sci-fi arena, not an esports broadcast and not a SaaS dashboard. The arena is the product. Chrome stays compact, dark, and functional; cyan and amber energy make team ownership immediately legible. Surfaces are nearly black metal with thin structural seams. Glow is localized to active controls, reactors, cores, dashes, and selected states.

The first decision must be clear within three seconds:

- Landing: enter name, then create or join.
- Lobby: choose team if allowed, become ready, then host starts.
- Match: read score/time, move, carry, and use dash.
- Result: understand winner, compare statistics, ready for rematch.

## Tokens

```css
:root {
  --color-bg: #05080c;
  --color-bg-raised: #0a1016;
  --color-surface: #0d151d;
  --color-surface-strong: #111c26;
  --color-border: #21313f;
  --color-border-strong: #365065;
  --color-text: #edf7fb;
  --color-text-muted: #8da4b4;
  --color-cyan: #25d9f8;
  --color-cyan-dim: #0e7085;
  --color-amber: #ffb347;
  --color-amber-dim: #8c5620;
  --color-ready: #77e34d;
  --color-warning: #ffc857;
  --color-danger: #ff5d6c;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 14px;
  --focus-ring: 0 0 0 2px #05080c, 0 0 0 4px #25d9f8;
  --motion-fast: 120ms;
  --motion-normal: 200ms;
}
```

No external font may be required at runtime. UI text uses `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`; the timer, room code, score, and compact technical labels use `"SFMono-Regular", Consolas, "Liberation Mono", monospace`. The mark uses the UI stack at weight 650 with wide tracking rather than a raster logo.

## Component inventory

- `AppShell`: true near-black full viewport, subtle CSS noise/grid, no marketing wrapper.
- `TopBar`: mark left; contextual score/phase in the middle when relevant; room, connection, and sound right.
- `TechFrame`: one purposeful angular border treatment around a primary surface. It is not repeated as nested cards.
- `TeamPanel`: open cyan or amber list region with compact player rows.
- `PlayerRow`: team dot, escaped name, optional host crown icon, connection state, and ready state.
- `CommandButton`: angular silhouette, solid dark fill, thin colored edge, strong focus-visible treatment; primary/secondary/danger variants.
- `TextField`: persistent label, dark input well, team-colored focus border, inline error below without clearing input.
- `StatusLight`: small semantic circle plus text; never color-only.
- `GameHud`: code-native score/time, cooldown, carried-core, ping, controls, and sound.
- `ResultTable`: two team regions, readable player/delivery/tackle columns, no chart or fake progression.
- `ConnectionOverlay`: retains the last game frame, darkens it slightly, and gives reconnect reason/deadline.
- `ToastRegion`: short non-blocking pickup/tackle/score/connection events; `aria-live="polite"`.

## Allowed visible copy

### Shared

`NEON RELAY`, `ODA`, `Bağlı`, `Bağlantı kuruluyor`, `Ses açık`, `Ses kapalı`, `WASD: Hareket`, `SPACE: Hamle`.

### Landing

`LAN ARENA`, `Oyuncu adı`, `Adın`, `Oda Kur`, `Oda kodu`, `Odaya Katıl`, `Aynı ağdaki arkadaşlarınla oyna`, plus exact inline validation/error messages from the protocol.

### Lobby

`Camgöbeği Takım`, `Kehribar Takım`, `Kodu Kopyala`, `Hazır`, `Bekliyor`, `Hazırım`, `Hazır Değilim`, `Maçı Başlat`, `Bağlantı bekleniyor`.

### Match

`ÇEKİRDEK`, `TAŞIYOR`, `HAMLE`, `ALTIN ÇEKİRDEK`, `Oyuncu yeniden bağlanıyor`, countdown numerals, team scores, player names, and regulation time.

### Result

`Camgöbeği Kazandı`, `Kehribar Kazandı`, `Oyuncu`, `Teslimat`, `Tackle`, `Hazır`, `Bekliyor`, `Tekrar Hazır`, `Hazır Değilim`, `Lobiye Dön`.

No extra eyebrow, badge, fake stat, reward, XP, rank, achievement, or marketing copy is allowed.

## State and interaction treatment

- Hover: border and text brighten; geometry does not jump.
- Active: one-pixel inward translate and reduced glow.
- Focus: the global double focus ring; never remove the browser-visible indication without replacement.
- Disabled: 42% opacity, neutral border, `not-allowed`, no glow.
- Pending: keep button width stable, replace only trailing action mark with a small spinner, and prevent duplicate submission.
- Ready: semantic green check plus `Hazır` text.
- Disconnected reservation: muted player row with countdown text; never remove the slot until canonical room state does.
- Error: inline red text and border; input values remain.
- Reduced motion: disable drift, trail, and scale animations; retain opacity/state changes under 100 ms.

## Responsive desktop rules

- 1440×900: concept-native composition.
- 1280×720: compact vertical spacing; the arena remains fully visible with HUD rails reduced.
- 1024×768: team/player rows become denser; no label clips and primary actions stay above the fold.
- 900×600: minimum supported size; top bar and command rail shrink, match canvas letterboxes, and nonessential control hints condense.
- Below 900×600: show the explicit viewport warning rather than squeezing or clipping the game.
- No mobile/touch layout exists.

## Game rendering inventory

- `public/assets/arena-floor.png`: generated opaque 1672×941 top-down floor layer; render scaled to the 1280×720 logical arena.
- React/Canvas draws reactors, barriers, pads, cores, drones, name labels, and event effects from canonical geometry/state over the floor asset.
- Drone silhouette follows the concept: circular dark-metal body, four compact vanes, team-color center and edge energy, short team-color dash trail, bright core orbit while carrying, broken energy ring while stunned.
- Reactors use concentric industrial rings with team-color energy; barriers use graphite slabs with a single team-neutral edge highlight.
- Core pads use dark concentric rings; normal cores are white-blue, sudden-death core is white-gold.

## Asset deviation

The built-in image generator produced the requested 4×2 drone sprite sheet twice with a baked checkerboard instead of real alpha. Filesystem inspection confirmed `hasAlpha: no`; the invalid sprite file was removed. To avoid shipping visibly broken raster tiles, player drones remain code-native Canvas vectors guided by the generated match concept. This is an intentional production blocker deviation; arena floor art remains generated and project-bound.

## Motion

- Buttons: 120 ms border/glow feedback.
- Screen entry: 180 ms opacity plus 6 px settle, once.
- Dash: short 160 ms team-color trail tied to authoritative state.
- Pickup: 180 ms core contraction and HUD acknowledgement.
- Tackle: 140 ms ring impulse and restrained one-frame camera nudge; disabled for reduced motion.
- Score: reactor pulse plus score digit change, no blocking celebration.
- Reconnect: static retained frame and countdown; no infinite decorative animation.
