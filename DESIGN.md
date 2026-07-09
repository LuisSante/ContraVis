---
name: ContraVis
description: Evidence-grounded visual analytics for contradiction review in legal contracts
colors:
  background: "oklch(0.985 0.007 75)"
  foreground: "oklch(0.23 0.008 55)"
  primary: "oklch(0.51 0.214 277)"
  primary-foreground: "oklch(0.985 0 0)"
  accent-foreground: "oklch(0.42 0.15 277)"
  secondary: "oklch(0.965 0.008 75)"
  muted: "oklch(0.965 0.008 75)"
  muted-foreground: "oklch(0.55 0.012 60)"
  accent: "oklch(0.95 0.012 75)"
  destructive: "oklch(0.577 0.245 27.325)"
  border: "oklch(0.91 0.01 75)"
  ring: "oklch(0.58 0.19 277)"
  canvas: "#f5f1e9"
  card: "oklch(1 0 0)"
  header: "#faf8f3"
  header-foreground: "#292524"
  reference-chip-text: "#0369a1"
  reference-chip-bg: "#e0f2fe"
  reference-chip-border: "#7dd3fc"
  chart-blue: "oklch(0.62 0.18 262)"
  chart-teal: "oklch(0.6 0.13 200)"
  chart-purple: "oklch(0.6 0.16 300)"
  chart-amber: "oklch(0.68 0.15 75)"
  chart-green: "oklch(0.62 0.18 150)"
typography:
  headline:
    fontFamily: "Avenir Web, Inter Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Avenir Web, Inter Variable, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Avenir Web, Inter Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Avenir Web, Inter Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  reference-chip:
    backgroundColor: "{colors.reference-chip-bg}"
    textColor: "{colors.reference-chip-text}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: ContraVis

## 1. Overview

**Creative North Star: "The Analytical Instrument"**

ContraVis looks and behaves like a precision instrument for a serious task, not
a piece of software with opinions. The reviewer is an expert reading dense legal
text and tracing contradictions across a typed paragraph graph; every visual
decision serves that work and then gets out of the way. Neutral warm-tinted
chrome recedes to the edges. A single indigo accent and a small vocabulary of
semantic colors do all the signalling — nothing decorative competes with the
document and its graph, which are always the protagonists on screen.

The system is warm-neutral rather than cold-corporate. Backgrounds sit at a soft
warm off-white (never stark clinical white, never cream/beige AI-default), the
document canvas is a gentle sand so the white page pops against it, and text is a
warm near-black tuned for long reading sessions. Depth is real but disciplined:
surfaces are calm at rest and lift with a soft shadow on hover and focus, giving
controls a tactile, confident response without turning the interface into a pile
of floating cards.

What this system explicitly rejects: the **outdated-legaltech** look — heavy
corporate blue, dense gray data tables, 2000s enterprise chrome. It equally
rejects generic AI-SaaS slop (purple gradients, glassmorphism, hero-metric
dashboards) and playful consumer aesthetics. The reference point is
Observable / graph-analysis tooling: coordinated views, deliberate exploration,
restraint everywhere the data isn't.

**Key Characteristics:**
- Warm-neutral surfaces; one indigo accent carries identity and primary action.
- The document and its paragraph graph hold the center; chrome recedes.
- Semantic color is meaning, never decoration — contradiction, reference, state.
- Flat at rest, tactile on interaction: soft elevation answers hover and focus.
- Full light + dark theming through OKLCH tokens; contrast tuned for reading.

## 2. Colors

A warm-neutral foundation with a single saturated indigo accent and a disciplined
set of semantic hues for graph encodings and states.

### Primary
- **Instrument Indigo** (`oklch(0.51 0.214 277)`): The one identity color. Carries
  primary buttons, active selection, focus rings, and the current-item state.
  Used sparingly — its rarity is what makes it read as "the important thing."
- **Indigo Ink** (`oklch(0.42 0.15 277)`, `--accent-foreground`): A deeper indigo
  for text/icons sitting on the pale accent surface, and for hover emphasis.

### Secondary
- **Sky Reference** (`#0369a1` text / `#e0f2fe` fill / `#7dd3fc` border): The
  dedicated color of a cross-reference chip inside the document — a distinct sky
  blue kept separate from the indigo accent so a reference never reads as a
  primary action.

### Tertiary
- **Graph Encodings** (`chart-blue` `oklch(0.62 0.18 262)`, `chart-teal`
  `oklch(0.6 0.13 200)`, `chart-purple` `oklch(0.6 0.16 300)`, `chart-amber`
  `oklch(0.68 0.15 75)`, `chart-green` `oklch(0.62 0.18 150)`): A five-hue set for
  encoding relationships, categories, and analysis types across coordinated views.
  Deployed by role, never for decoration.
- **Alert Red** (`oklch(0.577 0.245 27.325)`, `--destructive`): Destructive
  actions and error states only.

### Neutral
- **Warm Off-White** (`oklch(0.985 0.007 75)`, `--background`): The app body. Warm
  enough to feel considered, light enough to disappear.
- **Sand Canvas** (`#f5f1e9`, `--canvas`): The gutter around the white document
  page, so the page reads as a physical sheet lifted off the surface.
- **Paper White** (`oklch(1 0 0)`, `--card`): Cards, popovers, and the document
  page itself.
- **Warm Ink** (`oklch(0.23 0.008 55)`, `--foreground`): Primary text. A warm
  near-black, not pure black, for comfortable long-form reading.
- **Muted Warm Gray** (`oklch(0.55 0.012 60)`, `--muted-foreground`): Secondary
  text and labels. Held light enough to recede but dark enough to clear 4.5:1.
- **Hairline** (`oklch(0.91 0.01 75)`, `--border` / `--input`): Borders, dividers,
  input strokes.
- **Header Slate** (`#faf8f3` bar / `#292524` text): The top chrome bar — a quiet
  near-white so data and semantic colors below it stand out.

### Named Rules
**The One Accent Rule.** Instrument Indigo appears on ≤10% of any screen —
primary action, current selection, focus. If two things on a screen are indigo,
one of them is wrong.

**The Meaning-Only Color Rule.** Every non-neutral color must encode meaning: a
state, a category, a relationship, an action. Color for atmosphere is forbidden.

## 3. Typography

**Body Font:** Avenir Web (with Inter Variable, then system sans as fallback)
**Label/UI Font:** same family — one typeface carries the whole interface.

**Character:** A single humanist-geometric sans across headings, labels, data,
and body. Product UI doesn't need a display/body pairing; one well-tuned family
in multiple weights (400/500/600/700) gives hierarchy without noise. Avenir's
even, open letterforms stay legible at the small sizes a dense analytical tool
demands.

### Hierarchy
- **Headline** (600, 1.5rem/24px, line-height 1.25, tracking -0.01em): Panel and
  view titles.
- **Title** (600, 1.125rem/18px, line-height 1.3): Section headers, dialog titles.
- **Body** (400, 0.875rem/14px, line-height 1.5): Default UI text and prose.
  Legal prose capped at 65–75ch for readability.
- **Label** (500, 0.75rem/12px, line-height 1.4): Buttons, chips, metadata, form
  labels. Sentence case, not uppercase.

### Named Rules
**The Fixed-Scale Rule.** Type sizes are a fixed rem scale, never fluid clamp().
Users work at consistent DPI; a heading that shrinks inside a sidebar looks
broken, not responsive.

**The No-Shout Rule.** Labels are sentence case. No wide-tracked uppercase
eyebrows — they belong to marketing pages, not an instrument.

## 4. Elevation

The system is flat at rest and lifts on interaction — a "tactile and confident"
posture, not a flat-minimalist one. Surfaces carry no ambient shadow by default;
depth is a *response* to state. Outline buttons wear a hairline shadow (`shadow-xs`)
to read as pressable, and interactive surfaces raise a soft shadow on hover and
focus. The document page is the one persistent lift: the sand canvas behind it
does the elevation work, so the sheet reads as a physical page.

### Shadow Vocabulary
- **Hairline** (`box-shadow: 0 1px 2px rgba(0,0,0,0.05)`): Resting affordance on
  outline buttons and inputs — just enough to say "interactive."
- **Lifted** (`box-shadow: 0 4px 12px rgba(0,0,0,0.08)`): Hover/focus response on
  buttons, cards, and menu surfaces. Soft, diffuse, warm-neutral.
- **Overlay** (`box-shadow: 0 8px 24px rgba(0,0,0,0.12)`): Popovers, dialogs, and
  floating panels that sit above the working surface.

### Named Rules
**The Response-Not-Rest Rule.** Shadow answers interaction; it is never ambient
decoration on a resting surface. If a static card is casting a heavy shadow while
idle, the shadow is wrong.

## 5. Components

### Buttons
- **Shape:** Softly rounded (10px, `--radius` / `rounded-md`).
- **Primary:** Instrument Indigo fill, white text, `8px 16px` padding, 36px tall
  (`h-9`). Hover darkens to `primary/90`.
- **Secondary:** Warm-gray fill (`--secondary`), ink text; hover to `secondary/80`.
- **Outline:** Background fill, hairline border, Hairline shadow; hover fills with
  the pale accent surface.
- **Ghost / Link:** No chrome at rest; ghost fills accent on hover, link uses
  indigo with underline-on-hover.
- **Sizes:** `xs` (24px) → `sm` (32px) → `default` (36px) → `lg` (40px), plus
  square icon variants. Focus shows a 3px `ring/50` halo.

### Chips
- **Reference Chip (signature):** The in-document cross-reference. Sky-blue system
  (`#e0f2fe` fill, `#0369a1` text, `#7dd3fc` border), 6px radius, 9px semibold
  text, `2px 6px` padding. Deliberately sky, not indigo, so a reference never
  competes with a primary action. Hover deepens the sky; focus shows a sky ring.
- **Badge:** Pill-shaped (`rounded-full`), 12px medium text; default is indigo,
  with secondary / outline / ghost / destructive variants for status.

### Cards / Containers
- **Corner Style:** 10px radius (`--radius`), larger radii available on the scale.
- **Background:** Paper White (`--card`) on the warm off-white body.
- **Shadow Strategy:** Flat at rest, Lifted on hover per the Elevation rules.
- **Border:** Hairline (`--border`) when definition is needed.
- **Internal Padding:** 24px (`lg`) default.

### Inputs / Fields
- **Style:** Paper background, Hairline border, 10px radius.
- **Focus:** Border shifts to `--ring` indigo with a 3px `ring/50` halo — the same
  focus language as buttons, for one consistent vocabulary.
- **Error / Disabled:** `aria-invalid` shows a destructive border + ring; disabled
  drops to 50% opacity with pointer events off.

### Navigation
- **Header bar:** Quiet near-white (`--header` `#faf8f3`) with dark slate text, so
  the chrome recedes and semantic colors in the workspace stand out. Sidebar uses
  its own cool-neutral token layer, with indigo marking the active item.

### Signature: The Document Canvas
The white document page floating on the Sand Canvas gutter is the heart of the
UI. Reference chips, contradiction markers, and paragraph highlights live *inside*
this page. The canvas is where "the document is the protagonist" becomes literal.

## 6. Do's and Don'ts

### Do:
- **Do** keep Instrument Indigo to ≤10% of any screen (primary action, current
  selection, focus) — its scarcity is the signal.
- **Do** make every non-neutral color encode meaning: a state, category,
  relationship, or action.
- **Do** use one type family (Avenir Web) in weights 400–700 for all hierarchy.
- **Do** keep type on a fixed rem scale; never fluid clamp() headings in the app.
- **Do** treat shadow as a response to hover/focus, not ambient decoration.
- **Do** keep the document and its graph visually dominant; chrome recedes.
- **Do** hold body/label contrast ≥ 4.5:1 — no light-gray-for-elegance text on a
  tool people read for hours.

### Don't:
- **Don't** reach for the outdated-legaltech look: heavy corporate blue, dense
  gray data tables, 2000s enterprise chrome.
- **Don't** use purple/indigo gradients, glassmorphism, or hero-metric dashboards
  (generic AI-SaaS slop).
- **Don't** introduce a second accent that competes with Instrument Indigo; the
  sky reference-chip color is the one deliberate exception, scoped to references.
- **Don't** use wide-tracked uppercase eyebrows or shout-case labels.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe on
  cards, list items, or callouts.
- **Don't** apply gradient text (`background-clip: text` over a gradient) as
  decoration.
- **Don't** cast heavy shadows on resting surfaces or stack nested cards.
