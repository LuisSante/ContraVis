# Product

## Register

product

## Users

Legal reviewers and lawyers performing human-in-the-loop contradiction analysis
on real contracts. They arrive with a `.docx` contract and a serious,
high-stakes task: find and validate contradictions that emerge across distant,
interconnected provisions. Secondary users are researchers/academics evaluating
the system (SIBGRAPI context), but the primary surface must serve the practicing
legal reviewer in a focused review workflow — reading dense legal text,
inspecting evidence, exploring paragraph-graph neighborhoods, and confirming or
rejecting flagged contradictions.

## Product Purpose

ContraVis is a visual analytics system for evidence-grounded contradiction review
in legal contracts. It models a contract as a typed paragraph graph (explicit
references + semantic relationships) and pairs graph-conditioned LLM reasoning
with coordinated visual exploration. Success is a reviewer who trusts the
system's flags, can trace every claim back to its evidence in the document, and
reaches a defensible verdict faster than by manual review — without the tool ever
substituting its judgment for theirs.

## Brand Personality

Precise, rigorous, calm, and transparent. The voice is that of an expert
instrument, not an assistant with opinions. Three words: **precise,
evidence-grounded, unobtrusive.** The interface should convey three things at
once, held in balance:

- **Confidence & rigor** — decisions carry legal weight; nothing decorative may
  dilute the sense of precision.
- **Clarity & calm** — complex documents and dense graphs demand low cognitive
  load and frictionless navigation.
- **Expert control** — the human is in the loop; the UI grants power, density,
  and full transparency rather than over-simplifying.

## Anti-references

- **Outdated legaltech** (the primary anti-reference): heavy corporate blue,
  dense gray data tables, a 2000s enterprise-software feel. ContraVis must feel
  like a modern analytical instrument, not legacy compliance software.
- Generic AI SaaS slop: purple gradients, glassmorphism, hero-metric templates.
- Playful consumer aesthetics: saturated colors, illustrations, gratuitous motion.

The intended quality reference is **Observable / graph-analysis tooling** —
coordinated views, deliberate exploration of relationships, the document and its
graph as the protagonists, restraint everywhere else.

## Design Principles

1. **The document is the protagonist.** Legal text and its paragraph graph hold
   the center; chrome, panels, and controls recede around them.
2. **Every claim traces to evidence.** Contradictions, references, and LLM output
   must always be one glance from the source paragraph that grounds them. No
   opaque assertions.
3. **Instrument, not assistant.** Expose state and reasoning transparently; give
   the expert control and density instead of simplifying decisions away.
4. **Calm under complexity.** Dense information is the job; earn it with clear
   hierarchy, consistent affordances, and quiet color — never with clutter.
5. **Restraint is the brand.** Color and motion carry state and meaning only.
   Familiarity and consistency screen-to-screen beat novelty.

## Accessibility & Inclusion

Target **WCAG AA**: body text contrast ≥ 4.5:1 (≥ 3:1 for large text), visible
keyboard focus on all interactive elements, logical tab order, and semantic
markup. Given long reading sessions on dense legal text, prioritize legibility
(no light-gray-for-elegance body text) and honor `prefers-reduced-motion`.
Graph/color encodings should not rely on hue alone (color-blind safe), since the
system leans on visual encoding of relationships and contradiction states.
