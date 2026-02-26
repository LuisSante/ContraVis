<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { api } from '$lib/api/client';
	import {
		currentDocument,
		error,
		loading,
		paragraphs,
		selectedParagraph
	} from '$lib/stores/document';
	import type {
		Edge as GraphEdge,
		Node as ParagraphNode,
		XmlNode,
		ChangeLogState,
		ParagraphEditState,
		RelatedParagraph
	} from '$lib/types/document';
	import { appendChildren, localName, normalizeEditableText } from '$lib/utils/paragraph';
	import { createRenderer } from '$lib/utils/docx/renderer';
	import {
		buildInspectorState,
		createEmptyInspectorState,
		focusNodeFromPanel as focusNodeFromInspectorPanel,
		toSelectedParagraphNode
	} from '$lib/utils/docx/inspector';
	import {
		fetchBackendGraph,
		loadBrowserDocx4js,
		resolveDocumentMeta,
		updateRelationBadge
	} from '$lib/utils/docx-page';
	import {
		ensureNodeEditState,
		formatReferenceSummary,
		getNodeCurrentText,
		truncateText
	} from '$lib/utils/edit';

	let viewer: HTMLDivElement | null = null;
	let activeDocumentId: string | null = null;
	let activeDocumentName = '';
	let localError: string | null = null;
	let renderToken = 0;
	let releaseDoc: (() => void) | null = null;
	const initialInspectorState = createEmptyInspectorState();
	let selectedNodeId: string | null = initialInspectorState.selectedNodeId;
	let selectedChangeLog: ChangeLogState = initialInspectorState.selectedChangeLog;
	let selectedRelatedParagraphs: RelatedParagraph[] =
		initialInspectorState.selectedRelatedParagraphs;
	let backendEdges: GraphEdge[] = [];
	let backendGraphLoading = false;
	let graphComputationToken = 0;
	const nodeEditStateById = new Map<string, ParagraphEditState>();
	const paragraphElementById = new Map<string, HTMLElement>();
	const paragraphRelationHostById = new Map<string, HTMLElement>();
	const relationsCountByNodeId = new Map<string, number>();

	function refreshInspector(selectedNode: ParagraphNode | null = get(selectedParagraph)) {
		const nextState = buildInspectorState({
			selectedNode,
			paragraphNodes: get(paragraphs),
			backendEdges,
			paragraphElementById,
			nodeEditStateById
		});
		selectedNodeId = nextState.selectedNodeId;
		selectedChangeLog = nextState.selectedChangeLog;
		selectedRelatedParagraphs = nextState.selectedRelatedParagraphs;
	}

	function setSelectedParagraphNode(selectedNode: ParagraphNode | null) {
		const nodeWithCurrent = toSelectedParagraphNode(selectedNode, nodeEditStateById);
		selectedParagraph.set(nodeWithCurrent);
		refreshInspector(nodeWithCurrent);
	}

	function focusNodeFromPanel(nodeId: string) {
		focusNodeFromInspectorPanel({
			nodeId,
			paragraphNodes: get(paragraphs),
			paragraphElementById,
			onFallbackFocus: setSelectedParagraphNode
		});
	}

	function resetInspectorState() {
		graphComputationToken += 1;
		backendEdges = [];
		backendGraphLoading = false;
		relationsCountByNodeId.clear();
		const resetState = buildInspectorState({
			selectedNode: null,
			paragraphNodes: [],
			backendEdges: [],
			paragraphElementById,
			nodeEditStateById
		});
		selectedNodeId = resetState.selectedNodeId;
		selectedChangeLog = resetState.selectedChangeLog;
		selectedRelatedParagraphs = resetState.selectedRelatedParagraphs;
		nodeEditStateById.clear();
		paragraphElementById.clear();
		paragraphRelationHostById.clear();
	}

	async function recomputeBackendEdges(docId: string, nodesSnapshot: ParagraphNode[]) {
		const requestToken = ++graphComputationToken;
		if (nodesSnapshot.length === 0) {
			backendEdges = [];
			backendGraphLoading = false;
			refreshInspector();
			return;
		}

		backendGraphLoading = true;

		try {
			const { edges, relationsByNodeId } = await fetchBackendGraph(
				docId,
				nodesSnapshot,
				nodeEditStateById
			);

			if (requestToken !== graphComputationToken || activeDocumentId !== docId) return;

			backendEdges = edges;

			relationsCountByNodeId.clear();
			for (const node of nodesSnapshot) {
				const count = relationsByNodeId.get(node.id) ?? 0;
				relationsCountByNodeId.set(node.id, count);
				updateRelationBadge(paragraphRelationHostById, relationsCountByNodeId, node.id);
			}

			paragraphs.update((existingNodes) =>
				existingNodes.map((node) => ({
					...node,
					relationsCount: relationsCountByNodeId.get(node.id) ?? 0
				}))
			);

			refreshInspector();
		} catch (graphError) {
			if (requestToken !== graphComputationToken || activeDocumentId !== docId) return;
			console.error('Failed to compute backend graph edges:', graphError);
			backendEdges = [];
			refreshInspector();
		} finally {
			if (requestToken === graphComputationToken && activeDocumentId === docId) {
				backendGraphLoading = false;
			}
		}
	}

	function clearRenderedDocument(clearStores = true) {
		if (releaseDoc) {
			releaseDoc();
			releaseDoc = null;
		}
		if (viewer) viewer.replaceChildren();
		resetInspectorState();
		if (clearStores) {
			paragraphs.set([]);
			setSelectedParagraphNode(null);
		}
	}

	async function renderDocument(docId: string) {
		const token = ++renderToken;
		loading.set(true);
		error.set(null);
		localError = null;
		paragraphs.set([]);
		setSelectedParagraphNode(null);

		try {
			const metadata = await resolveDocumentMeta(docId);
			if (token !== renderToken) return;
			activeDocumentId = docId;
			activeDocumentName = metadata?.name ?? `${docId}.docx`;

			const response = await api.get<ArrayBuffer>(`/document_file/${encodeURIComponent(docId)}`, {
				responseType: 'arraybuffer'
			});
			if (token !== renderToken) return;

			const docx4jsModule = await loadBrowserDocx4js();
			if (token !== renderToken) return;

			const parsedDoc = await docx4jsModule.docx.load(response.data);
			if (token !== renderToken) {
				parsedDoc.release?.();
				return;
			}

			const nodesById = new Map<string, ParagraphNode>();
			const upsertParagraphNode = (node: ParagraphNode) => {
				const state = ensureNodeEditState(nodeEditStateById, node.id, node.text);
				state.current = normalizeEditableText(node.text);
				nodesById.set(node.id, node);
				paragraphs.set(
					Array.from(nodesById.values()).sort((a, b) => a.paragraph_enum - b.paragraph_enum)
				);
			};
			const focusParagraphNode = (node: ParagraphNode) => {
				setSelectedParagraphNode(node);
			};
			const commitParagraphNode = (node: ParagraphNode) => {
				const state = ensureNodeEditState(nodeEditStateById, node.id, node.text);
				state.current = normalizeEditableText(node.text);
				state.committed = state.current;
				state.editedSinceCommit = false;

				const selected = get(selectedParagraph);
				if (selected?.id === node.id) {
					setSelectedParagraphNode(node);
				}

				const snapshot = Array.from(nodesById.values()).sort(
					(left, right) => left.paragraph_enum - right.paragraph_enum
				);
				void recomputeBackendEdges(docId, snapshot);
			};

			clearRenderedDocument(false);
			releaseDoc = typeof parsedDoc.release === 'function' ? () => parsedDoc.release?.() : null;

			const identify = (
				node: XmlNode,
				officeDocument: {
					constructor: { identify: (node: XmlNode, officeDocument: unknown) => unknown };
				}
			) => {
				const tag = localName(node.name);
				if (tag === 'styles' || tag === 'numbering') return null;
				return officeDocument.constructor.identify(node, officeDocument);
			};

			const renderedRoot = parsedDoc.render(
				createRenderer(
					docId,
					{
						onNodeUpsert: upsertParagraphNode,
						onNodeFocus: focusParagraphNode,
						onNodeCommit: commitParagraphNode
					},
					{
						nodeEditStateById,
						paragraphElementById,
						paragraphRelationHostById,
						relationsCountByNodeId,
						getSelectedNodeId: () => selectedNodeId
					}
				),
				identify
			);
			if (token !== renderToken || !viewer) return;

			viewer.replaceChildren();
			appendChildren(viewer, renderedRoot);

			const snapshot = Array.from(nodesById.values()).sort(
				(left, right) => left.paragraph_enum - right.paragraph_enum
			);
			void recomputeBackendEdges(docId, snapshot);
		} catch (err) {
			if (token !== renderToken) return;
			activeDocumentId = null;
			activeDocumentName = '';
			localError = err instanceof Error ? err.message : 'Failed to render DOCX document.';
			error.set(localError);
			clearRenderedDocument();
		} finally {
			if (token === renderToken) loading.set(false);
		}
	}

	async function openFromRoute(docIdFromRoute: string | null) {
		const fallbackId = get(currentDocument)?.id ?? null;
		const docId = docIdFromRoute ?? fallbackId;

		if (!docId) {
			activeDocumentId = null;
			activeDocumentName = '';
			localError = 'Select a document in the dataset list first.';
			clearRenderedDocument();
			return;
		}

		if (activeDocumentId === docId && viewer?.childNodes.length) return;
		await renderDocument(docId);
	}

	onMount(() => {
		const unsubscribe = page.subscribe(($page) => {
			void openFromRoute($page.url.searchParams.get('id'));
		});

		return () => {
			renderToken += 1;
			unsubscribe();
			clearRenderedDocument();
		};
	});
</script>

<main class="relative flex h-screen w-screen overflow-hidden bg-gray-100 font-sans max-lg:flex-col">
	<div
		class="flex w-[60%] min-w-0 flex-col border-r border-gray-300 max-lg:h-[58%] max-lg:w-full max-lg:border-r-0 max-lg:border-b"
	>
		<header class="flex flex-none items-center gap-3 border-b border-gray-300 bg-gray-50 px-4 py-3">
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold text-gray-800">
					{activeDocumentName || 'No document selected'}
				</div>
			</div>
		</header>

		{#if localError || $error}
			<div class="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
				{localError ?? $error}
			</div>
		{/if}

		<section class="flex min-h-0 flex-1 flex-col items-center overflow-auto px-2 py-4 shadow-inner">
			<div bind:this={viewer} class="min-h-full w-full"></div>
		</section>
	</div>

	<aside
		class="flex min-h-0 w-[40%] flex-col overflow-hidden bg-white shadow-xl max-lg:h-[42%] max-lg:w-full"
	>
		<div class="flex flex-none flex-col border-b border-gray-200">
			<header
				class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2"
			>
				<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Node Diff</h3>
				<div class="group relative inline-flex">
					<span
						class="cursor-help rounded border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-bold tracking-tight text-gray-600"
						title="Commit changes with Ctrl + Shift + Enter"
					>
						CTRL + SHIFT + ENTER
					</span>
					<div
						class="pointer-events-none absolute top-full right-0 z-20 mt-1 rounded bg-gray-800 px-2 py-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-white opacity-0 shadow-2xl ring-1 ring-white/20 transition-opacity group-hover:opacity-100 {selectedChangeLog.hasChanges
							? 'animate-bounce'
							: ''}"
					>
						Ctrl + Shift + Enter to save
					</div>
				</div>
			</header>

			<div class="max-h-[35vh] overflow-y-auto p-3">
				{#if !$selectedParagraph || !selectedChangeLog.hasChanges}
					<div class="flex flex-col items-center justify-center py-2 text-gray-300">
						<p class="text-[10px] italic">No active changes</p>
					</div>
				{:else}
					<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
						<div class="border-b border-gray-50 bg-red-50/20 px-3 py-2">
							<span class="mb-1 block text-[8px] font-bold text-red-300 uppercase">Original</span>
							<p class="font-mono leading-relaxed text-red-700/80">
								{#each selectedChangeLog.oldSegments as segment}
									{#if segment.changed}
										<mark class="bg-red-100 px-0.5 text-red-800">{segment.value}</mark>
									{:else}
										<span>{segment.value}</span>
									{/if}
								{/each}
							</p>
						</div>

						<div class="bg-green-50/20 px-3 py-2">
							<span class="mb-1 block text-[8px] font-bold text-green-300 uppercase">Modified</span>
							<p class="font-mono leading-relaxed text-green-800">
								{#each selectedChangeLog.newSegments as segment}
									{#if segment.changed}
										<mark class="bg-green-100 px-0.5 text-green-800">{segment.value}</mark>
									{:else}
										<span>{segment.value}</span>
									{/if}
								{/each}
							</p>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<div class="flex min-h-0 flex-1 flex-col">
			<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
				<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
					Related Paragraphs
				</h3>
			</header>

			<div
				class="flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto overscroll-contain bg-gray-50/30 p-2"
			>
				{#if !$selectedParagraph}
					<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
						<svg
							class="mb-2 h-6 w-6 opacity-20"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							/>
						</svg>
						<p class="text-[10px] font-medium tracking-widest uppercase">Select text to analyze</p>
					</div>
				{:else if selectedRelatedParagraphs.length === 0}
					<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
						<p class="text-[10px] italic">No relations found for this element</p>
					</div>
				{:else}
					{#each selectedRelatedParagraphs as related}
						<button
							type="button"
							class="group rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
							on:click={() => focusNodeFromPanel(related.node.id)}
						>
							<div class="mb-2 flex items-center justify-between">
								<div class="flex flex-wrap items-center gap-1.5">
									{#if related.relationTypes.includes('semantic_similarity')}
										<span
											class="rounded border border-green-100 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-600 uppercase"
										>
											Similarity
										</span>
									{/if}
									{#if related.relationTypes.includes('reference')}
										<span
											class="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 uppercase"
										>
											Reference
										</span>
									{/if}
									{#if related.semanticScore != null}
										<span class="text-[9px] font-semibold text-gray-500">
											{(related.semanticScore * 100).toFixed(1)}%
										</span>
									{/if}
								</div>
								<span class="text-[9px] font-bold tracking-tighter text-gray-400 uppercase">
									Page {related.node.page}
								</span>
							</div>

							<p class="text-[11px] leading-relaxed text-gray-600">
								{truncateText(getNodeCurrentText(nodeEditStateById, related.node))}
							</p>

							{#if related.references.length}
								<p class="mt-2 text-[10px] text-gray-500">
									Refs: {formatReferenceSummary(related.references)}
								</p>
							{/if}
						</button>
					{/each}
				{/if}
			</div>
		</div>
	</aside>

	{#if backendGraphLoading}
		<div
			class="absolute inset-0 z-50 flex items-center justify-center bg-white/65 backdrop-blur-[1.5px]"
		>
			<div
				class="backend-loader-card flex items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3 shadow-xl"
			>
				<div class="relative h-5 w-5" aria-hidden="true">
					<span class="absolute inset-0 rounded-full border-2 border-gray-200"></span>
					<span
						class="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500"
					></span>
				</div>
				<p class="text-[11px] font-semibold tracking-tight text-gray-600">
					Loading backend relationships...
				</p>
			</div>
		</div>
	{/if}
</main>

<style>
	:global([contenteditable='true'])::selection {
		background: rgba(250, 204, 21, 0.3);
	}

	:global(.docx-relations-badge-host) {
		position: relative;
		transition: background-color 140ms ease;
	}

	:global(.docx-relations-badge-host)::before {
		content: '';
		position: absolute;
		right: -14px;
		top: 2px;
		bottom: 2px;
		width: 2px;
		border-radius: 9999px;
		background: #d1d5db;
		pointer-events: none;
	}

	:global(.docx-relations-badge-host[data-relations-tone='linked'])::before {
		background: #60a5fa;
	}

	:global(.docx-relations-badge-host)::after {
		content: attr(data-relations-count);
		position: absolute;
		right: -24px;
		top: 50%;
		display: inline-flex;
		height: 22px;
		width: 22px;
		min-width: 22px;
		transform: translateY(-50%);
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid #d1d5db;
		background: #f3f4f6;
		color: #6b7280;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		pointer-events: none;
	}

	:global(.docx-relations-badge-host[data-relations-tone='linked'])::after {
		border-color: #93c5fd;
		background: #dbeafe;
		color: #1d4ed8;
	}

	:global(.overflow-y-auto)::-webkit-scrollbar {
		width: 3px;
	}

	:global(.overflow-y-auto)::-webkit-scrollbar-track {
		background: transparent;
	}

	:global(.overflow-y-auto)::-webkit-scrollbar-thumb {
		background: #f3f4f6;
		border-radius: 10px;
	}

	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-3px);
		}
	}

	.animate-bounce {
		animation: bounce 2s infinite;
	}
</style>
