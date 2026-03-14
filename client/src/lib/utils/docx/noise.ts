import { normalizeEditableText } from '$lib/utils/docx/dom';

const PAGE_NUMBER_ONLY_RE = /^(?:\d+|[ivxlcdm]{1,8})$/i;
const PAGE_LABEL_RE = /^(?:page|pagina|p[aá]g\.?)\s*\d+(?:\s*(?:\/|of|de)\s*\d+)?$/i;
const MAX_REPEATED_BOUNDARY_LENGTH = 180;
const MAX_REPEATED_BOUNDARY_WORDS = 22;
const BOUNDARY_SCAN_LINES = 3;

type BoundaryNode = {
	nodeId: string;
	text: string;
};

function normalizeNodeText(raw: string): string {
	return normalizeEditableText(raw).replace(/\s+/g, ' ').trim();
}

function isLikelyPageMarker(text: string): boolean {
	if (!text) return false;
	if (PAGE_NUMBER_ONLY_RE.test(text)) return true;
	return PAGE_LABEL_RE.test(text);
}

function isLikelyRepeatedBoundary(text: string): boolean {
	if (!text) return false;
	if (isLikelyPageMarker(text)) return true;
	if (text.length > MAX_REPEATED_BOUNDARY_LENGTH) return false;
	const words = text.split(/\s+/).filter(Boolean);
	return words.length > 0 && words.length <= MAX_REPEATED_BOUNDARY_WORDS;
}

function collectSectionParagraphNodes(section: HTMLElement): BoundaryNode[] {
	const orderedNodes = Array.from(section.querySelectorAll<HTMLElement>('[data-node-id]'));
	const nodes: BoundaryNode[] = [];

	for (const element of orderedNodes) {
		const nodeId = element.dataset.nodeId;
		if (!nodeId) continue;
		const text = normalizeNodeText(element.innerText ?? '');
		if (!text) continue;
		nodes.push({ nodeId, text });
	}

	return nodes;
}

function findRepeatedBoundaryTexts(entries: BoundaryNode[]): Set<string> {
	const counts = new Map<string, number>();
	for (const entry of entries) {
		const key = entry.text.toLowerCase();
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const repeated = new Set<string>();
	for (const [key, count] of counts.entries()) {
		if (count >= 2 && isLikelyRepeatedBoundary(key)) {
			repeated.add(key);
		}
	}

	return repeated;
}

export function detectDocxNoiseNodeIds(root: ParentNode): string[] {
	const noiseNodeIds = new Set<string>();
	const allParagraphs = Array.from(root.querySelectorAll<HTMLElement>('[data-node-id]'));

	for (const paragraphEl of allParagraphs) {
		const nodeId = paragraphEl.dataset.nodeId;
		if (!nodeId) continue;
		const text = normalizeNodeText(paragraphEl.innerText ?? '');
		if (isLikelyPageMarker(text)) {
			noiseNodeIds.add(nodeId);
		}
	}

	const sections = Array.from(root.querySelectorAll<HTMLElement>('section'));
	if (sections.length === 0) return Array.from(noiseNodeIds);

	const topEntries: BoundaryNode[] = [];
	const bottomEntries: BoundaryNode[] = [];

	for (const section of sections) {
		const sectionNodes = collectSectionParagraphNodes(section);
		if (sectionNodes.length === 0) continue;
		topEntries.push(...sectionNodes.slice(0, BOUNDARY_SCAN_LINES));
		bottomEntries.push(...sectionNodes.slice(Math.max(sectionNodes.length - BOUNDARY_SCAN_LINES, 0)));
	}

	const repeatedTopTexts = findRepeatedBoundaryTexts(topEntries);
	const repeatedBottomTexts = findRepeatedBoundaryTexts(bottomEntries);

	for (const entry of topEntries) {
		if (repeatedTopTexts.has(entry.text.toLowerCase())) {
			noiseNodeIds.add(entry.nodeId);
		}
	}

	for (const entry of bottomEntries) {
		if (repeatedBottomTexts.has(entry.text.toLowerCase())) {
			noiseNodeIds.add(entry.nodeId);
		}
	}

	return Array.from(noiseNodeIds);
}
