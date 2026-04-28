import { highlightMap } from '$lib/constants/graph';
import type { XmlNode } from '$lib/types/document';
import {
	findChild,
	getAttr,
	isOn,
	localName,
	normalizeColor,
	toBorderPx,
	toNumber,
	toTwipsPx
} from '$lib/utils/docx/xml';

const MIN_RUN_FONT_SIZE_PT = 6;
const MIN_SUP_SUB_RUN_FONT_SIZE_PT = 5;
const MAX_RUN_FONT_SIZE_PT = 72;
const PARAGRAPH_SPACING_SCALE = 0.62;

function clampRunFontSizePt(rawHalfPointSize: number, isSuperOrSub: boolean): number {
	const resolvedPt = rawHalfPointSize / 2;
	const minPt = isSuperOrSub ? MIN_SUP_SUB_RUN_FONT_SIZE_PT : MIN_RUN_FONT_SIZE_PT;
	return Math.min(Math.max(resolvedPt, minPt), MAX_RUN_FONT_SIZE_PT);
}

export function hasOnlySectionBreak(pr?: XmlNode | null): boolean {
	if (!pr?.children || pr.children.length !== 1) return false;
	return localName(pr.children[0].name) === 'sectpr';
}

export function getParagraphStyleId(pr?: XmlNode | null): string | null {
	if (!pr) return null;
	return getAttr(findChild(pr, 'pstyle'), 'val') ?? null;
}

export function getParagraphStyles(pr?: XmlNode | null): Record<string, string> {
	const style: Record<string, string> = {
		'margin-top': '0',
		'margin-bottom': '0',
		'line-height': '1',
		'white-space': 'pre-wrap',
		'word-break': 'break-word'
	};

	if (!pr) return style;

	const alignment = getAttr(findChild(pr, 'jc'), 'val')?.toLowerCase();
	if (alignment === 'both') style['text-align'] = 'justify';
	if (alignment && alignment !== 'both') style['text-align'] = alignment;

	const spacing = findChild(pr, 'spacing');
	const before = toTwipsPx(getAttr(spacing, 'before'));
	const after = toTwipsPx(getAttr(spacing, 'after'));
	const line = toNumber(getAttr(spacing, 'line'));
	const lineRule = getAttr(spacing, 'lineRule')?.toLowerCase();

	if (before != null) style['margin-top'] = `${Math.max(before * PARAGRAPH_SPACING_SCALE, 0)}px`;
	if (after != null) style['margin-bottom'] = `${Math.max(after * PARAGRAPH_SPACING_SCALE, 0)}px`;
	if (line != null) {
		if (lineRule === 'auto') {
			style['line-height'] = `${Math.max(1, line / 240)}`;
		} else {
			const linePx = toTwipsPx(line);
			if (linePx != null) style['line-height'] = `${Math.max(linePx, 1)}px`;
		}
	}

	const indent = findChild(pr, 'ind');
	const left = toTwipsPx(getAttr(indent, 'left'));
	const right = toTwipsPx(getAttr(indent, 'right'));
	const firstLine = toTwipsPx(getAttr(indent, 'firstLine'));
	const hanging = toTwipsPx(getAttr(indent, 'hanging'));

	if (left != null) style['margin-left'] = `${left}px`;
	if (right != null) style['margin-right'] = `${right}px`;
	if (firstLine != null) style['text-indent'] = `${firstLine}px`;
	if (hanging != null) style['text-indent'] = `${-hanging}px`;

	return style;
}

export function getRunStyles(pr?: XmlNode | null): Record<string, string> {
	const style: Record<string, string> = {};
	if (!pr) return style;

	const bold = findChild(pr, 'b') ?? findChild(pr, 'bcs');
	const italic = findChild(pr, 'i') ?? findChild(pr, 'ics');
	const underline = findChild(pr, 'u');
	const strike = findChild(pr, 'strike') ?? findChild(pr, 'dstrike');
	const caps = findChild(pr, 'caps');
	const smallCaps = findChild(pr, 'smallcaps');
	const verticalAlign = findChild(pr, 'vertalign');
	const color = findChild(pr, 'color');
	const size = findChild(pr, 'sz');
	const fonts = findChild(pr, 'rfonts');
	const highlight = findChild(pr, 'highlight');
	const characterSpacing = toNumber(getAttr(pr, 'spacing'));

	if (isOn(bold)) style['font-weight'] = '700';
	if (isOn(italic)) style['font-style'] = 'italic';
	if (underline && (getAttr(underline, 'val') ?? 'single').toLowerCase() !== 'none') {
		style['text-decoration-line'] = 'underline';
	}
	if (isOn(strike)) style['text-decoration-line'] = 'line-through';
	if (isOn(caps)) style['text-transform'] = 'uppercase';
	if (isOn(smallCaps)) style['font-variant'] = 'small-caps';

	const va = getAttr(verticalAlign, 'val')?.toLowerCase();
	if (va === 'superscript') style['vertical-align'] = 'super';
	if (va === 'subscript') style['vertical-align'] = 'sub';

	const colorValue = normalizeColor(getAttr(color, 'val'));
	if (colorValue) style.color = colorValue;

	const fontSize = toNumber(getAttr(size, 'val'));
	if (fontSize != null) {
		const isSuperOrSub = va === 'superscript' || va === 'subscript';
		style['font-size'] = `${clampRunFontSizePt(fontSize, isSuperOrSub)}pt`;
	}

	const fontFamily =
		getAttr(fonts, 'ascii') ??
		getAttr(fonts, 'hAnsi') ??
		getAttr(fonts, 'eastAsia') ??
		getAttr(fonts, 'cs');
	if (fontFamily) style['font-family'] = `"${fontFamily}"`;
	if (characterSpacing != null && characterSpacing !== 0) {
		style['letter-spacing'] = `${characterSpacing / 20}pt`;
	}

	const highlightKey = getAttr(highlight, 'val')?.toLowerCase();
	if (highlightKey) {
		style['background-color'] = highlightMap[highlightKey] ?? highlightKey;
	}

	return style;
}

export function getSectionLayout(sectPr?: XmlNode | null) {
	const defaultLayout = {
		width: 793,
		height: 1122,
		marginTop: 96,
		marginRight: 96,
		marginBottom: 96,
		marginLeft: 96
	};

	if (!sectPr) return defaultLayout;

	const pgSz = findChild(sectPr, 'pgsz');
	const pgMar = findChild(sectPr, 'pgmar');

	let width = toTwipsPx(getAttr(pgSz, 'w')) ?? defaultLayout.width;
	let height = toTwipsPx(getAttr(pgSz, 'h')) ?? defaultLayout.height;
	const orient = getAttr(pgSz, 'orient')?.toLowerCase();
	if (orient === 'landscape' && width < height) {
		[width, height] = [height, width];
	}

	return {
		width,
		height,
		marginTop: toTwipsPx(getAttr(pgMar, 'top')) ?? defaultLayout.marginTop,
		marginRight: toTwipsPx(getAttr(pgMar, 'right')) ?? defaultLayout.marginRight,
		marginBottom: toTwipsPx(getAttr(pgMar, 'bottom')) ?? defaultLayout.marginBottom,
		marginLeft: toTwipsPx(getAttr(pgMar, 'left')) ?? defaultLayout.marginLeft
	};
}

export function parseBorder(border?: XmlNode): string | null {
	if (!border) return null;
	const val = (getAttr(border, 'val') ?? 'single').toLowerCase();
	if (val === 'none' || val === 'nil') return 'none';

	const width = Math.max(toBorderPx(getAttr(border, 'sz')) ?? 0.5, 0.5);
	const color = normalizeColor(getAttr(border, 'color')) ?? '#000000';
	const cssType = val.includes('dot') ? 'dotted' : val.includes('dash') ? 'dashed' : 'solid';
	return `${width}px ${cssType} ${color}`;
}
