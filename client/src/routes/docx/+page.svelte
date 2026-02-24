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
		DocumentMeta,
		Docx4jsBrowserModule,
		Node as ParagraphNode,
		XmlNode,
		ParagraphKind,
		ChangeLogState,
		ParagraphEditState,
		RelatedParagraph
	} from '$lib/types/document';
	import { 
		EMPTY_CHANGE_LOG
	} from '$lib/constant';
	import { 
		localName, 
		getAttr, 
		findChild, 
		toTwipsPx, 
		toNumber, 
		toNodeList, 
		setStyles, 
		appendChildren, 
		normalizeEditableText, 
		resolveDocx4jsFromRequire,
		getSectionLayout,
		getParagraphStyles,
		getRunStyles,
		hasOnlySectionBreak,
		parseBorder
	} from '$lib/utils/paragraph';
	import {
		buildChangeLog,
		buildRelatedParagraphs,
		ensureNodeEditState,
		formatReferenceSummary,
		getNodeCurrentText,
		truncateText,
		updateSelectionHighlight
	} from '$lib/utils/edit';

	let viewer: HTMLDivElement | null = null;
	let activeDocumentId: string | null = null;
	let activeDocumentName = '';
	let localError: string | null = null;
	let renderToken = 0;
	let releaseDoc: (() => void) | null = null;
	let browserDocxModulePromise: Promise<Docx4jsBrowserModule> | null = null;
	let selectedNodeId: string | null = null;
	let selectedChangeLog: ChangeLogState = EMPTY_CHANGE_LOG;
	let selectedRelatedParagraphs: RelatedParagraph[] = [];
	const nodeEditStateById = new Map<string, ParagraphEditState>();
	const paragraphElementById = new Map<string, HTMLElement>();

	async function loadBrowserDocx4js(): Promise<Docx4jsBrowserModule> {
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

	function refreshInspector(selectedNode: ParagraphNode | null = get(selectedParagraph)) {
		selectedNodeId = selectedNode?.id ?? null;
		updateSelectionHighlight(paragraphElementById, selectedNodeId);

		if (!selectedNode) {
			selectedChangeLog = { ...EMPTY_CHANGE_LOG, oldSegments: [], newSegments: [] };
			selectedRelatedParagraphs = [];
			return;
		}

		const state = ensureNodeEditState(nodeEditStateById, selectedNode.id, selectedNode.text);
		selectedChangeLog = buildChangeLog(state.committed, state.current);
		selectedRelatedParagraphs = buildRelatedParagraphs(selectedNode, {
			nodes: get(paragraphs),
			nodeEditStateById
		});
	}

	function setSelectedParagraphNode(selectedNode: ParagraphNode | null) {
		if (!selectedNode) {
			selectedParagraph.set(null);
			refreshInspector(null);
			return;
		}

		const state = ensureNodeEditState(nodeEditStateById, selectedNode.id, selectedNode.text);
		const nodeWithCurrent = { ...selectedNode, text: state.current };
		selectedParagraph.set(nodeWithCurrent);
		refreshInspector(nodeWithCurrent);
	}

	function focusNodeFromPanel(nodeId: string) {
		const target = get(paragraphs).find((node) => node.id === nodeId);
		if (!target) return;

		const nodeElement = paragraphElementById.get(nodeId);
		if (nodeElement) {
			nodeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
			nodeElement.focus();
			return;
		}

		setSelectedParagraphNode(target);
	}

	function resetInspectorState() {
		updateSelectionHighlight(paragraphElementById, null);
		selectedNodeId = null;
		selectedChangeLog = { ...EMPTY_CHANGE_LOG, oldSegments: [], newSegments: [] };
		selectedRelatedParagraphs = [];
		nodeEditStateById.clear();
		paragraphElementById.clear();
	}

	function createRenderer(
		docId: string,
		onNodeUpsert: (node: ParagraphNode) => void,
		onNodeFocus: (node: ParagraphNode) => void,
		onNodeCommit: (node: ParagraphNode) => void
	) {
		const listState = new Map<string, number[]>();
		let paragraphCounter = 0;

		const nextListMarker = (numId: string | undefined, level: number): string => {
			if (!numId) return '*';
			const key = String(numId);
			const counters = listState.get(key) ?? [];
			counters[level] = (counters[level] ?? 0) + 1;
			counters.length = level + 1;
			listState.set(key, counters);
			return `${counters[level]}.`;
		};

		const attachParagraphEditor = (element: HTMLElement, kind: ParagraphKind) => {
			paragraphCounter += 1;
			const paragraphEnum = paragraphCounter;
			const nodeId = `${docId}-p-${paragraphEnum}`;

			const baseNode: ParagraphNode = {
				id: nodeId,
				documentId: docId,
				text: '',
				paragraph_enum: paragraphEnum,
				page: 1,
				relationsCount: 0
			};

			element.dataset.nodeId = nodeId;
			element.dataset.paragraphKind = kind;
			element.setAttribute('contenteditable', 'true');
			element.setAttribute('spellcheck', 'false');
			paragraphElementById.set(nodeId, element);
			element.classList.add(
				'rounded-[2px]',
				'-mx-[2px]',
				'px-[2px]',
				'outline-none',
				'transition-all',
				'hover:ring-1',
				'hover:ring-blue-300',
				'focus:ring-2',
				'focus:ring-yellow-400'
			);

			const syncText = (): ParagraphNode => {
				const text = normalizeEditableText(element.innerText ?? '');
				const node = { ...baseNode, text };
				onNodeUpsert(node);
				return node;
			};

			element.addEventListener('input', () => {
				const state = ensureNodeEditState(nodeEditStateById, nodeId, element.innerText ?? '');
				state.editedSinceCommit = true;
				const node = syncText();
				if (selectedNodeId === node.id || document.activeElement === element) {
					onNodeFocus(node);
				}
			});

			element.addEventListener('focus', () => {
				const node = syncText();
				const state = ensureNodeEditState(nodeEditStateById, node.id, node.text);
				if (!state.editedSinceCommit && state.committed !== state.current) {
					state.committed = state.current;
				}
				onNodeFocus(node);
			});

			element.addEventListener('keydown', (event: KeyboardEvent) => {
				if (!(event.key === 'Enter' && event.ctrlKey && event.shiftKey)) return;
				event.preventDefault();
				const node = syncText();
				onNodeCommit(node);
			});

			const node = syncText();
			if (selectedNodeId === node.id) {
				onNodeFocus(node);
			}
		};

		return (type: string, props: Record<string, unknown> = {}, children: unknown) => {
			const safeProps =
				props && typeof props === 'object' && !Array.isArray(props)
					? (props as Record<string, unknown>)
					: {};

			try {
				switch (type) {
					case 'document': {
						const root = document.createElement('div');
						root.className = 'mx-auto flex w-full max-w-max flex-col items-center gap-4';
						appendChildren(root, children);
						return root;
					}
					case 'section': {
						const section = document.createElement('section');
						section.className =
							'overflow-hidden bg-white text-gray-900 shadow-[0_8px_24px_rgba(17,24,39,0.1)]';
						const layout = getSectionLayout((safeProps.node as XmlNode) ?? null);
						section.style.width = `${layout.width}px`;
						section.style.minHeight = `${layout.height}px`;
						section.style.padding = `${layout.marginTop}px ${layout.marginRight}px ${layout.marginBottom}px ${layout.marginLeft}px`;
						appendChildren(section, children);
						return section;
					}
					case 'heading': {
						const level = Math.min(Math.max(toNumber(safeProps.outline) ?? 1, 1), 6);
						const heading = document.createElement(`h${level}`);
						heading.className = 'font-bold whitespace-pre-wrap break-words [tab-size:4]';
						setStyles(heading, getParagraphStyles((safeProps.pr as XmlNode) ?? null));
						appendChildren(heading, children);
						attachParagraphEditor(heading, 'heading');
						return heading;
					}
					case 'list': {
						const item = document.createElement('p');
						item.className = 'flex items-start gap-2 whitespace-pre-wrap break-words [tab-size:4]';
						const level = Math.max(toNumber(safeProps.level) ?? 0, 0);

						const marker = document.createElement('span');
						marker.className = 'w-7 shrink-0 text-right';
						marker.textContent = nextListMarker(
							typeof safeProps.numId === 'string' ? safeProps.numId : undefined,
							level
						);
						marker.setAttribute('contenteditable', 'false');

						const content = document.createElement('span');
						content.className = 'block min-w-0 flex-1 whitespace-pre-wrap break-words [tab-size:4]';
						appendChildren(content, children);

						setStyles(item, getParagraphStyles((safeProps.pr as XmlNode) ?? null));
						if (!item.style.paddingLeft) item.style.paddingLeft = `${(level + 1) * 20}px`;

						item.appendChild(marker);
						item.appendChild(content);
						attachParagraphEditor(content, 'list');
						return item;
					}
					case 'p': {
						const paragraph = document.createElement('p');
						paragraph.className = 'whitespace-pre-wrap break-words [tab-size:4]';
						setStyles(paragraph, getParagraphStyles((safeProps.pr as XmlNode) ?? null));
						if (
							hasOnlySectionBreak((safeProps.pr as XmlNode) ?? null) &&
							toNodeList(children).length === 0
						) {
							paragraph.classList.add('min-h-[1px]');
						}
						appendChildren(paragraph, children);
						attachParagraphEditor(paragraph, 'paragraph');
						return paragraph;
					}
					case 'r': {
						const run = document.createElement('span');
						run.className = 'whitespace-pre-wrap';
						setStyles(run, getRunStyles((safeProps.pr as XmlNode) ?? null));
						appendChildren(run, children);
						return run;
					}
					case 't':
						return document.createTextNode(
							toNodeList(children)
								.map((n) => n.textContent ?? '')
								.join('')
						);
					case 'tab':
						return document.createTextNode('\t');
					case 'br':
						return document.createElement('br');
					case 'hyperlink': {
						const link = document.createElement('a');
						link.className = 'text-blue-700 underline';
						const rawUrl = safeProps.url as { url?: string } | string | undefined;
						const href = typeof rawUrl === 'string' ? rawUrl : rawUrl?.url;
						if (href) {
							link.href = href;
							if (!href.startsWith('#')) {
								link.target = '_blank';
								link.rel = 'noreferrer noopener';
							}
						}
						appendChildren(link, children);
						return link;
					}
					case 'tbl': {
						const table = document.createElement('table');
						table.className = 'my-1 w-full table-fixed border-collapse';
						const tblPr = safeProps.pr as XmlNode | undefined;
						const width = findChild(tblPr, 'tblw');
						const widthValue = toNumber(getAttr(width, 'w'));
						const widthType = getAttr(width, 'type')?.toLowerCase();
						if (widthValue != null && widthType === 'dxa') {
							table.style.width = `${toTwipsPx(widthValue) ?? widthValue}px`;
						}
						appendChildren(table, children);
						return table;
					}
					case 'tr': {
						const row = document.createElement('tr');
						appendChildren(row, children);
						return row;
					}
					case 'tc': {
						const cell = document.createElement('td');
						cell.className = 'align-top px-1 py-1';
						const tcPr = safeProps.pr as XmlNode | undefined;
						const borders = findChild(tcPr, 'tcborders');
						const top = parseBorder(findChild(borders, 'top'));
						const right = parseBorder(findChild(borders, 'right'));
						const bottom = parseBorder(findChild(borders, 'bottom'));
						const left = parseBorder(findChild(borders, 'left'));
						if (top) cell.style.borderTop = top;
						if (right) cell.style.borderRight = right;
						if (bottom) cell.style.borderBottom = bottom;
						if (left) cell.style.borderLeft = left;
						appendChildren(cell, children);
						return cell;
					}
					case 'drawing':
					case 'drawing.anchor': {
						const drawing = document.createElement('span');
						drawing.className = 'inline-block';
						appendChildren(drawing, children);
						return drawing;
					}
					case 'drawing.inline': {
						const drawing = document.createElement('span');
						drawing.className = 'inline-block max-w-full';
						appendChildren(drawing, children);
						return drawing;
					}
					case 'picture': {
						const img = document.createElement('img');
						img.className = 'block h-auto max-w-full object-contain';
						const shape = safeProps as {
							xfrm?: { width?: number; height?: number };
							blipFill?: { blip?: { url?: string } };
						};
						const src = shape.blipFill?.blip?.url;
						if (src) img.src = src;
						appendChildren(img, children);
						return img;
					}
					default: {
						const fragment = document.createDocumentFragment();
						appendChildren(fragment, children);
						return fragment;
					}
				}
			} catch (renderErr) {
				console.error('DOCX render node error:', type, safeProps, renderErr);
				return document.createDocumentFragment();
			}
		};
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

	async function resolveDocumentMeta(docId: string): Promise<DocumentMeta | null> {
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
			};

			clearRenderedDocument(false);
			releaseDoc = typeof parsedDoc.release === 'function' ? () => parsedDoc.release?.() : null;

			const identify = (
				node: XmlNode,
				officeDocument: { constructor: { identify: (node: XmlNode, officeDocument: unknown) => unknown } }
			) => {
				const tag = localName(node.name);
				if (tag === 'styles' || tag === 'numbering') return null;
				return officeDocument.constructor.identify(node, officeDocument);
			};

			const renderedRoot = parsedDoc.render(
				createRenderer(docId, upsertParagraphNode, focusParagraphNode, commitParagraphNode),
				identify
			);
			if (token !== renderToken || !viewer) return;

			viewer.replaceChildren();
			appendChildren(viewer, renderedRoot);
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
	<div class="flex w-[60%] min-w-0 flex-col border-r border-gray-300 max-lg:h-[58%] max-lg:w-full max-lg:border-r-0 max-lg:border-b">
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

	<aside class="flex w-[40%] min-h-0 flex-col overflow-hidden bg-white shadow-xl max-lg:h-[42%] max-lg:w-full">
		<div class="flex flex-none flex-col border-b border-gray-200">
			<header class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
				<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Node Diff</h3>
				<div class="group relative inline-flex">
					<span
						class="cursor-help rounded border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-bold tracking-tight text-gray-600"
						title="Commit changes with Ctrl + Shift + Enter"
					>
						CTRL + SHIFT + ENTER
					</span>
					<div
						class="pointer-events-none absolute right-0 top-full z-20 mt-1 rounded bg-gray-800 px-2 py-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-white opacity-0 shadow-2xl ring-1 ring-white/20 transition-opacity group-hover:opacity-100 {selectedChangeLog.hasChanges ? 'animate-bounce' : ''}"
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
				<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Related Paragraphs</h3>
			</header>

			<div class="flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto overscroll-contain bg-gray-50/30 p-2">
				{#if !$selectedParagraph}
					<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
						<svg class="mb-2 h-6 w-6 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
										<span class="rounded border border-green-100 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-600">
											Similarity
										</span>
									{/if}
									{#if related.relationTypes.includes('reference')}
										<span class="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-600">
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
</main>

<style>
	:global([contenteditable='true'])::selection {
		background: rgba(250, 204, 21, 0.3);
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
