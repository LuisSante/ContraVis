import type { 
	ExtractedElement, 
	ExtractedPage, 
	Node, 
	Line, 
	Paragraph,
	LayoutElement,
	LayoutPage
} from '$lib/types/document';
import { 
	LINE_HEIGHT_MULTIPLIER, 
	PAGE_PADDING, 
	COLLISION_GAP, 
	MAX_FONT_SIZE, 
	MIN_FONT_SIZE, 
	MIN_TEXT_BLOCK_WIDTH,
	LIST_MARKER_RE, 
	LIST_LINE_RE, 
	RIGHT_PUNCT_RE, 
	LEFT_PUNCT_RE
} from '$lib/constant';

function median(nums: number[]) {
	const a = [...nums].filter(Number.isFinite).sort((x, y) => x - y);
	if (!a.length) return 0;
	const mid = Math.floor(a.length / 2);
	return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function approxTextWidthPx(text: string, fontSize: number) {
	return text.length * fontSize * 0.55;
}

function itemWidthPx(item: ExtractedElement, fallbackFontSize: number) {
	if (typeof item.width === 'number' && item.width > 0) return item.width;
	return approxTextWidthPx(item.text ?? '', fallbackFontSize || 12);
}

function getLineStartX(line: Line) {
	const firstX = line.items[0]?.x ?? 0;
	if (line.items.length < 2) return firstX;

	const firstToken = (line.items[0]?.text ?? '').trim();
	if (LIST_MARKER_RE.test(firstToken)) return line.items[1]?.x ?? firstX;
	return firstX;
}

function groupIntoLines(pageNumber: number, elements: ExtractedElement[]): Line[] {
	const els = elements.filter((e) => e.text && e.text.trim() !== '');
	if (!els.length) return [];

	const fontMed = median(els.map((e) => e.fontSize).filter((x) => x > 0)) || 12;
	const yTol = Math.max(2, fontMed * 0.45);
	const sorted = [...els].sort((a, b) => a.y - b.y || a.x - b.x);

	const lines: Line[] = [];
	for (const el of sorted) {
		const last = lines[lines.length - 1];
		if (last && Math.abs(el.y - last.y) <= yTol) {
			last.items.push(el);
			last.y = (last.y * (last.items.length - 1) + el.y) / last.items.length;
			last.fontSize = (last.fontSize * (last.items.length - 1) + el.fontSize) / last.items.length;
			continue;
		}
		lines.push({ page: pageNumber, y: el.y, fontSize: el.fontSize, items: [el] });
	}

	for (const ln of lines) {
		ln.items.sort((a, b) => a.x - b.x);
	}
	lines.sort((a, b) => a.y - b.y || (a.items[0]?.x ?? 0) - (b.items[0]?.x ?? 0));
	return lines;
}

function lineToText(line: Line) {
	const font = line.fontSize || 12;
	const spaceThreshold = Math.max(font * 0.3, 2);
	let out = '';
	let lastRight = -Infinity;

	for (const it of line.items) {
		const raw = it.text ?? '';
		if (!raw) continue;

		const text = raw.replace(/\s+/g, ' ');
		if (!text.trim()) {
			if (out && !out.endsWith(' ')) out += ' ';
			continue;
		}

		const trimmed = text.trim();
		const gap = it.x - lastRight;
		const gapNeedsSpace = Number.isFinite(gap) && gap > spaceThreshold;
		const charNeedsSpace = out.length > 0 && !out.endsWith(' ') && !RIGHT_PUNCT_RE.test(trimmed);

		if ((gapNeedsSpace || text.startsWith(' ')) && charNeedsSpace) {
			out += ' ';
		}

		out += trimmed;
		lastRight = it.x + itemWidthPx(it, font);
	}

	return out.replace(/[ \t]+/g, ' ').trim();
}

function isLikelyHeading(lineText: string) {
	const t = lineText.trim();
	if (!t) return false;

	const letters = t.replace(/[^A-Za-z]/g, '');
	if (!letters.length) return false;

	const upper = t.replace(/[^A-Z]/g, '').length;
	const ratio = upper / letters.length;
	return ratio > 0.85 && t.length >= 6;
}

function isListStart(lineText: string) {
	return LIST_LINE_RE.test(lineText);
}

function appendFlowingText(current: string, next: string) {
	const left = current.trimEnd();
	const right = next.trimStart();
	if (!left) return right;
	if (!right) return left;

	if (left.endsWith('-')) return left.slice(0, -1) + right;
	if (right.startsWith("'") || RIGHT_PUNCT_RE.test(right)) return left + right;
	if (LEFT_PUNCT_RE.test(right) && left.endsWith(' ')) return left + right;
	return `${left} ${right}`;
}

function groupLinesIntoParagraphs(lines: Line[]): Paragraph[] {
	if (!lines.length) return [];

	const paras: Paragraph[] = [];
	let cur: Paragraph | null = null;
	let curIsList = false;

	const medFont = median(lines.map((l) => l.fontSize).filter((x) => x > 0)) || 12;
	const dyValues = lines.slice(1).map((line, idx) => line.y - lines[idx].y).filter((dy) => dy > 0);
	const medDy = median(dyValues) || medFont * 1.1;
	const newParaGap = Math.max(medFont * 1.25, medDy * 1.45);
	const baseIndentTol = Math.max(4, medFont * 0.9);
	const listIndentTol = baseIndentTol * 2.2;

	for (const ln of lines) {
		const text = lineToText(ln);
		if (!text) continue;

		const lineStartX = getLineStartX(ln);
		const heading = isLikelyHeading(text);
		const listStart = isListStart(text);
		const prevLine = cur?.lines[cur.lines.length - 1];
		const prevStartX = prevLine ? getLineStartX(prevLine) : lineStartX;
		const dy = prevLine ? ln.y - prevLine.y : 0;
		const indentTol = curIsList && !listStart ? listIndentTol : baseIndentTol;
		const indentChange = Math.abs(lineStartX - prevStartX);

		const shouldStartNew =
			!cur || dy > newParaGap || heading || listStart || indentChange > indentTol;

		if (shouldStartNew) {
			if (cur) {
				cur.text = cur.text.trim();
				paras.push(cur);
			}
			cur = {
				page: ln.page,
				lines: [ln],
				text,
				x: lineStartX,
				y: ln.y,
				fontSize: ln.fontSize
			};
			curIsList = listStart;
			continue;
		}

		if (!cur) continue;

		cur.text = appendFlowingText(cur.text, text);
		cur.lines.push(ln);
	}

	if (cur) {
		cur.text = cur.text.trim();
		paras.push(cur);
	}

	return paras;
}

export function pagesToParagraphPages(pages: ExtractedPage[]): ExtractedPage[] {
	return pages.map((page) => {
		const lines = groupIntoLines(page.pageNumber, page.elements);
		const paras = groupLinesIntoParagraphs(lines);
		const elements: ExtractedElement[] = paras.map((p, index) => ({
			id: `p${page.pageNumber}-para${index + 1}`,
			text: p.text,
			x: p.x,
			y: p.y,
			fontSize: p.fontSize
		}));

		return {
			...page,
			elements
		};
	});
}

export function pagesToParagraphNodes(documentId: string, pages: ExtractedPage[]): Node[] {
	const nodes: Node[] = [];
	let pEnum = 1;

	for (const page of pagesToParagraphPages(pages)) {
		for (const p of page.elements) {
			nodes.push({
				id: `${documentId}-p${page.pageNumber}-para${pEnum}`,
				documentId,
				text: p.text,
				paragraph_enum: pEnum,
				page: page.pageNumber,
				relationsCount: 0,
				x: p.x,
				y: p.y,
				fontSize: p.fontSize
			});
			pEnum++;
		}
	}

	return nodes;
}

function clamp(value: number, min: number, max: number) {
	if (max < min) return min;
	return Math.min(Math.max(value, min), max);
}

function horizontalOverlap(aLeft: number, aRight: number, bLeft: number, bRight: number) {
	return Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
}

function estimateTextHeight(text: string, width: number, fontSize: number) {
	const lineHeight = Math.max(fontSize * LINE_HEIGHT_MULTIPLIER, fontSize + 2);
	const charsPerLine = Math.max(8, Math.floor(width / Math.max(fontSize * 0.55, 4)));
	const wrappedLines = text.split('\n').reduce((acc, line) => {
		const lineLength = line.trim().length || 1;
		return acc + Math.max(1, Math.ceil(lineLength / charsPerLine));
	}, 0);

	return wrappedLines * lineHeight;
}

function normalizePageLayout(page: ExtractedPage): LayoutPage {
	const sorted = [...page.elements].sort((a, b) => a.y - b.y || a.x - b.x);
	const placedBoxes: { left: number; right: number; bottom: number }[] = [];
	const elements: LayoutElement[] = [];
	let maxBottom = PAGE_PADDING;

	for (const el of sorted) {
		const fontSize = clamp(el.fontSize || 12, MIN_FONT_SIZE, MAX_FONT_SIZE);
		const maxLeft = page.width - PAGE_PADDING - MIN_TEXT_BLOCK_WIDTH;
		const boxX = clamp(el.x || PAGE_PADDING, PAGE_PADDING, maxLeft);
		const maxWidth = Math.max(MIN_TEXT_BLOCK_WIDTH, page.width - boxX - PAGE_PADDING);
		const preferredWidth = el.width && el.width > 0 ? el.width : maxWidth;
		const boxWidth = clamp(preferredWidth, MIN_TEXT_BLOCK_WIDTH, maxWidth);
		const boxHeight = estimateTextHeight(el.text, boxWidth, fontSize);

		let boxY = clamp(el.y || PAGE_PADDING, PAGE_PADDING, page.height - PAGE_PADDING);
		const blockingBottom = placedBoxes
			.filter((box) => horizontalOverlap(boxX, boxX + boxWidth, box.left, box.right) > 10)
			.reduce(
				(acc, box) => (box.bottom + COLLISION_GAP > boxY ? Math.max(acc, box.bottom) : acc),
				-Infinity
			);

		if (Number.isFinite(blockingBottom)) {
			boxY = blockingBottom + COLLISION_GAP;
		}

		elements.push({
			...el,
			fontSize,
			boxX,
			boxY,
			boxWidth,
			boxHeight
		});
		placedBoxes.push({ left: boxX, right: boxX + boxWidth, bottom: boxY + boxHeight });
		maxBottom = Math.max(maxBottom, boxY + boxHeight);
	}

	return {
		...page,
		height: Math.max(page.height, maxBottom + PAGE_PADDING),
		elements
	};
}

export function normalizePagesForRender(pages: ExtractedPage[]): LayoutPage[] {
	return pages.map((page) => normalizePageLayout(page));
}
