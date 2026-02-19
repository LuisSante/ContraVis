// constants for text analysis
export const LIST_MARKER_RE = /^(?:\d+[\.\)]|[A-Za-z][\.\)]|[-•])$/;
export const LIST_LINE_RE = /^\s*(?:\d+[\.\)]|[A-Za-z][\.\)]|[-•])\s+/;
export const RIGHT_PUNCT_RE = /^[\.,;:!\?\)\]\}]/;
export const LEFT_PUNCT_RE = /^[\(\[\{]/;


// constant for collision detection and layout
export const MIN_TEXT_BLOCK_WIDTH = 80;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 26;
export const COLLISION_GAP = 2;
export const PAGE_PADDING = 12;
export const LINE_HEIGHT_MULTIPLIER = 1.25;
export const NODE_COUNT_GUTTER = 36;
