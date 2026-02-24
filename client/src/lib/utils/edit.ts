import { diffWordsWithSpace } from 'diff';
import {
	EMPTY_CHANGE_LOG,
	MAX_RELATED_PARAGRAPHS,
	REFERENCE_PATTERNS,
	SEMANTIC_THRESHOLD
} from '$lib/constant';
import type {
	ChangeLogState,
	Node as ParagraphNode,
	ParagraphEditState,
	ReferenceMatch,
	RelatedParagraph,
	TokenDiffSegment,
	TokenVector
} from '$lib/types/document';
import { normalizeEditableText } from '$lib/utils/paragraph';

type BuildRelatedOptions = {
	nodes: ParagraphNode[];
	nodeEditStateById: Map<string, ParagraphEditState>;
	semanticThreshold?: number;
	maxRelatedParagraphs?: number;
};

export function ensureNodeEditState(
	nodeEditStateById: Map<string, ParagraphEditState>,
	nodeId: string,
	fallbackText: string
): ParagraphEditState {
	const normalizedFallback = normalizeEditableText(fallbackText ?? '');
	const existing = nodeEditStateById.get(nodeId);
	if (existing) return existing;

	const state: ParagraphEditState = {
		committed: normalizedFallback,
		current: normalizedFallback,
		editedSinceCommit: false
	};
	nodeEditStateById.set(nodeId, state);
	return state;
}

export function getNodeCurrentText(
	nodeEditStateById: Map<string, ParagraphEditState>,
	node: ParagraphNode
): string {
	return nodeEditStateById.get(node.id)?.current ?? node.text;
}

export function buildChangeLog(committedText: string, currentText: string): ChangeLogState {
	const oldText = normalizeEditableText(committedText);
	const newText = normalizeEditableText(currentText);
	if (oldText === newText) return { ...EMPTY_CHANGE_LOG, oldSegments: [], newSegments: [] };

	const oldSegments: TokenDiffSegment[] = [];
	const newSegments: TokenDiffSegment[] = [];
	let hasChanges = false;

	for (const segment of diffWordsWithSpace(oldText, newText)) {
		if (segment.removed) {
			oldSegments.push({ value: segment.value, changed: true });
			hasChanges = true;
			continue;
		}

		if (segment.added) {
			newSegments.push({ value: segment.value, changed: true });
			hasChanges = true;
			continue;
		}

		oldSegments.push({ value: segment.value, changed: false });
		newSegments.push({ value: segment.value, changed: false });
	}

	return { hasChanges, oldSegments, newSegments };
}

export function updateSelectionHighlight(
	paragraphElementById: Map<string, HTMLElement>,
	nextNodeId: string | null
) {
	for (const [nodeId, element] of paragraphElementById.entries()) {
		const isSelected = Boolean(nextNodeId && nodeId === nextNodeId);
		element.classList.toggle('z-10', isSelected);
		element.classList.toggle('bg-yellow-50/50', isSelected);
		element.classList.toggle('ring-2', isSelected);
		element.classList.toggle('ring-yellow-400', isSelected);
	}
}

function tokenizeWords(text: string): string[] {
	return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function buildTokenVector(text: string): TokenVector {
	const weights = new Map<string, number>();
	for (const token of tokenizeWords(text)) {
		weights.set(token, (weights.get(token) ?? 0) + 1);
	}

	let squaredNorm = 0;
	for (const value of weights.values()) {
		squaredNorm += value * value;
	}

	return { weights, magnitude: Math.sqrt(squaredNorm) };
}

function cosineSimilarity(a: TokenVector, b: TokenVector): number {
	if (a.magnitude === 0 || b.magnitude === 0) return 0;

	const left = a.weights.size <= b.weights.size ? a.weights : b.weights;
	const right = left === a.weights ? b.weights : a.weights;
	let dot = 0;

	for (const [token, value] of left.entries()) {
		const rightValue = right.get(token);
		if (rightValue == null) continue;
		dot += value * rightValue;
	}

	return dot / (a.magnitude * b.magnitude);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractReferences(text: string): ReferenceMatch[] {
	const matches: ReferenceMatch[] = [];
	const seen = new Set<string>();

	for (const { label, expression } of REFERENCE_PATTERNS) {
		const matcher = new RegExp(expression.source, expression.flags);
		for (const match of text.matchAll(matcher)) {
			const value = (match[1] ?? '').trim();
			if (!value) continue;
			const key = `${label}:${value.toLowerCase()}`;
			if (seen.has(key)) continue;

			seen.add(key);
			matches.push({ label, value });
		}
	}

	return matches;
}

function isReferenceTarget(text: string, reference: ReferenceMatch): boolean {
	const candidate = text.trim();
	if (!candidate) return false;

	const escapedValue = escapeRegExp(reference.value);
	const labeledMatch = new RegExp(`\\b${reference.label}\\s+${escapedValue}\\b`, 'i');
	if (labeledMatch.test(candidate)) return true;

	if (!/\d/.test(reference.value)) return false;
	const numericPrefix = new RegExp(`^\\(?${escapedValue}\\)?(?:[\\).:\\-]|\\s|$)`, 'i');
	return numericPrefix.test(candidate);
}

export function buildRelatedParagraphs(
	selectedNode: ParagraphNode,
	options: BuildRelatedOptions
): RelatedParagraph[] {
	const {
		nodes,
		nodeEditStateById,
		semanticThreshold = SEMANTIC_THRESHOLD,
		maxRelatedParagraphs = MAX_RELATED_PARAGRAPHS
	} = options;

	const selectedText = getNodeCurrentText(nodeEditStateById, selectedNode).trim();
	if (!selectedText) return [];
	if (nodes.length <= 1) return [];

	const selectedVector = buildTokenVector(selectedText);
	const references = extractReferences(selectedText);
	const relatedById = new Map<string, RelatedParagraph>();

	for (const candidate of nodes) {
		if (candidate.id === selectedNode.id) continue;
		const candidateText = getNodeCurrentText(nodeEditStateById, candidate).trim();
		if (!candidateText) continue;

		const matchedReferences = references.filter((reference) =>
			isReferenceTarget(candidateText, reference)
		);
		if (matchedReferences.length > 0) {
			const existing: RelatedParagraph = relatedById.get(candidate.id) ?? {
				node: candidate,
				relationTypes: [],
				references: []
			};
			if (!existing.relationTypes.includes('reference')) {
				existing.relationTypes.push('reference');
			}

			for (const reference of matchedReferences) {
				const exists = existing.references.some(
					(item) => item.label === reference.label && item.value === reference.value
				);
				if (!exists) existing.references.push(reference);
			}

			relatedById.set(candidate.id, existing);
		}

		const semanticScore = cosineSimilarity(selectedVector, buildTokenVector(candidateText));
		if (semanticScore >= semanticThreshold) {
			const existing: RelatedParagraph = relatedById.get(candidate.id) ?? {
				node: candidate,
				relationTypes: [],
				references: []
			};
			if (!existing.relationTypes.includes('semantic_similarity')) {
				existing.relationTypes.push('semantic_similarity');
			}
			existing.semanticScore = Math.max(existing.semanticScore ?? 0, semanticScore);
			relatedById.set(candidate.id, existing);
		}
	}

	return Array.from(relatedById.values())
		.sort((left, right) => {
			const leftReference = left.relationTypes.includes('reference') ? 1 : 0;
			const rightReference = right.relationTypes.includes('reference') ? 1 : 0;
			if (rightReference !== leftReference) return rightReference - leftReference;

			const leftSemantic = left.semanticScore ?? 0;
			const rightSemantic = right.semanticScore ?? 0;
			if (rightSemantic !== leftSemantic) return rightSemantic - leftSemantic;

			return left.node.paragraph_enum - right.node.paragraph_enum;
		})
		.slice(0, maxRelatedParagraphs);
}

export function truncateText(text: string, maxLength = 420): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, maxLength).trimEnd()}...`;
}

export function formatReferenceSummary(references: ReferenceMatch[]): string {
	const uniqueRefs = Array.from(
		new Set(references.map((reference) => `${reference.label} ${reference.value}`))
	);
	return uniqueRefs.join(', ');
}
