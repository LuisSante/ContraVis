import { get } from 'svelte/store';
import { api } from '$lib/api/client';
import { currentDocument } from '$lib/stores/document';
import type {
	AssistantChatRequest,
	AssistantChatResponse,
	ContradictionAnalysisRequest,
	ContradictionGraphMode,
	ContradictionAnalysisResponse,
	DocumentMeta,
	Docx4jsBrowserModule,
	Edge as GraphEdge,
	Node as ParagraphNode,
	ParagraphEditState,
	ProcessDocumentResponse,
	SavedContradictionsResponse,
	SimplifySelectionRequest,
	SimplifySelectionResponse
} from '$lib/types/document';
import { getNodeCurrentText } from '$lib/utils/edit';
import { resolveDocx4jsFromRequire } from '$lib/utils/docx/loader';

let browserDocxModulePromise: Promise<Docx4jsBrowserModule> | null = null;

export async function loadBrowserDocx4js(): Promise<Docx4jsBrowserModule> {
	if (browserDocxModulePromise) return browserDocxModulePromise;

	browserDocxModulePromise = new Promise<Docx4jsBrowserModule>((resolve, reject) => {
		const alreadyLoaded = resolveDocx4jsFromRequire();
		if (alreadyLoaded) {
			resolve(alreadyLoaded);
			return;
		}

		const scriptId = 'docx4js-browser-bundle';
		const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;

		const finish = () => {
			const loaded = resolveDocx4jsFromRequire();
			if (loaded) {
				resolve(loaded);
				return;
			}
			reject(new Error('docx4js browser bundle loaded, but module is unavailable.'));
		};

		const fail = () => {
			reject(new Error('Unable to load /vendor/docx4js.js'));
		};

		if (existingScript) {
			existingScript.addEventListener('load', finish, { once: true });
			existingScript.addEventListener('error', fail, { once: true });
			return;
		}

		const script = document.createElement('script');
		script.id = scriptId;
		script.src = '/vendor/docx4js.js';
		script.async = true;
		script.addEventListener('load', finish, { once: true });
		script.addEventListener('error', fail, { once: true });
		document.head.appendChild(script);
	}).catch((err) => {
		browserDocxModulePromise = null;
		throw err;
	});

	return browserDocxModulePromise;
}

export async function resolveDocumentMeta(docId: string): Promise<DocumentMeta | null> {
	const selected = get(currentDocument);
	if (selected?.id === docId) return selected;

	try {
		const res = await api.get<DocumentMeta[]>('/list_documents');
		const found = res.data.find((doc) => doc.id === docId) ?? null;
		if (found) currentDocument.set(found);
		return found;
	} catch {
		return null;
	}
}

export function getRelationsCount(
	relationsCountByNodeId: Map<string, number>,
	nodeId: string
): number {
	return relationsCountByNodeId.get(nodeId) ?? 0;
}

export function updateRelationBadge(
	paragraphRelationHostById: Map<string, HTMLElement>,
	relationsCountByNodeId: Map<string, number>,
	nodeId: string,
	host?: HTMLElement | null
) {
	const target = host ?? paragraphRelationHostById.get(nodeId);
	if (!target) return;

	const relationsCount = getRelationsCount(relationsCountByNodeId, nodeId);
	if (relationsCount <= 0) {
		target.classList.remove(
			'docx-relations-badge-host',
			'docx-related-badge-emphasis',
			'docx-related-badge--reference',
			'docx-related-badge--similarity'
		);
		delete target.dataset.relationsCount;
		delete target.dataset.relationsTone;
		target.style.removeProperty('--docx-relations-badge-right');
		target.style.removeProperty('--docx-relations-guide-right');
		return;
	}

	target.classList.add('docx-relations-badge-host');
	target.dataset.relationsCount = String(relationsCount);
	target.dataset.relationsTone = 'linked';
	alignRelationBadgeToPage(target);
}

function parseCssPx(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function alignRelationBadgeToPage(target: HTMLElement) {
	if (typeof window === 'undefined') return;

	const applyAlignment = () => {
		const section = target.closest('section');
		if (!(section instanceof HTMLElement)) return;

		const targetRect = target.getBoundingClientRect();
		const sectionRect = section.getBoundingClientRect();
		if (targetRect.width <= 0 || sectionRect.width <= 0) return;

		const sectionStyles = window.getComputedStyle(section);
		const sectionPaddingRight = parseCssPx(sectionStyles.paddingRight);
		const pageTextRightPx = sectionRect.right - sectionPaddingRight;
		const badgeCenterX = pageTextRightPx + 14;

		target.style.setProperty(
			'--docx-relations-badge-right',
			`${targetRect.right - badgeCenterX - 11}px`
		);
		target.style.setProperty(
			'--docx-relations-guide-right',
			`${targetRect.right - badgeCenterX - 1}px`
		);
	};

	if (target.isConnected) {
		applyAlignment();
		return;
	}

	window.requestAnimationFrame(applyAlignment);
}

function buildProcessPages(
	nodes: ParagraphNode[],
	nodeEditStateById: Map<string, ParagraphEditState>
) {
	const pagesByNumber = new Map<number, Array<{ id: string; text: string }>>();

	for (const node of [...nodes].sort((a, b) => a.paragraph_enum - b.paragraph_enum)) {
		const pageNumber = Number.isFinite(node.page) && node.page > 0 ? node.page : 1;
		const pageElements = pagesByNumber.get(pageNumber) ?? [];
		pageElements.push({
			id: node.id,
			text: getNodeCurrentText(nodeEditStateById, node)
		});
		pagesByNumber.set(pageNumber, pageElements);
	}

	return Array.from(pagesByNumber.entries())
		.sort((left, right) => left[0] - right[0])
		.map(([pageNumber, elements]) => ({ pageNumber, elements }));
}

function buildDirectionalRelationsByNodeId(
	nodes: ParagraphNode[],
	edges: GraphEdge[]
): Map<string, number> {
	const neighborsByNodeId = new Map<string, Set<string>>();

	for (const node of nodes) {
		neighborsByNodeId.set(node.id, new Set<string>());
	}

	for (const edge of edges) {
		if (edge.type === 'reference') {
			// Keep references directional: source -> target
			const sourceNeighbors = neighborsByNodeId.get(edge.source);
			if (sourceNeighbors) sourceNeighbors.add(edge.target);
			continue;
		}

		if (edge.type === 'semantic_similarity') {
			// Semantic similarity is symmetric.
			const sourceNeighbors = neighborsByNodeId.get(edge.source);
			if (sourceNeighbors) sourceNeighbors.add(edge.target);

			const targetNeighbors = neighborsByNodeId.get(edge.target);
			if (targetNeighbors) targetNeighbors.add(edge.source);
		}
	}

	return new Map(
		Array.from(neighborsByNodeId.entries()).map(([nodeId, neighbors]) => [nodeId, neighbors.size] as const)
	);
}

export async function fetchBackendGraph(
	docId: string,
	nodesSnapshot: ParagraphNode[],
	nodeEditStateById: Map<string, ParagraphEditState>
): Promise<{ edges: GraphEdge[]; relationsByNodeId: Map<string, number> }> {
	const response = await api.post<ProcessDocumentResponse>('/process', {
		documentId: docId,
		pages: buildProcessPages(nodesSnapshot, nodeEditStateById)
	});

	const edges = response.data.graph.edges ?? [];
	const relationsByNodeId = buildDirectionalRelationsByNodeId(nodesSnapshot, edges);

	return { edges, relationsByNodeId };
}

export async function fetchAssistantResponse(
	payload: AssistantChatRequest
): Promise<AssistantChatResponse> {
	const response = await api.post<AssistantChatResponse>('/assistant/chat', payload);
	return response.data;
}

export async function fetchSimplifySelection(
	payload: SimplifySelectionRequest
): Promise<SimplifySelectionResponse> {
	const response = await api.post<SimplifySelectionResponse>('/assistant/simplify', payload);
	return response.data;
}

export async function fetchFixContradictionSelection(
	payload: SimplifySelectionRequest
): Promise<SimplifySelectionResponse> {
	const response = await api.post<SimplifySelectionResponse>('/assistant/fix_contradiction', payload);
	return response.data;
}

export async function fetchSavedContradictions(
	documentId: string,
	mode: ContradictionGraphMode
): Promise<SavedContradictionsResponse> {
	const response = await api.get<SavedContradictionsResponse>(
		`/contradictions/saved/${encodeURIComponent(documentId)}`,
		{
			params: { mode }
		}
	);
	return response.data;
}

export async function fetchContradictionAnalysis(
	payload: ContradictionAnalysisRequest
): Promise<ContradictionAnalysisResponse> {
	const response = await api.post<ContradictionAnalysisResponse>('/contradictions/analyze', payload);
	return response.data;
}
