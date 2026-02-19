<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
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
		XmlNode
	} from '$lib/types/document';

	type ParagraphKind = 'paragraph' | 'heading' | 'list';

	const highlightMap: Record<string, string> = {
		yellow: '#fff59d',
		green: '#a5d6a7',
		cyan: '#80deea',
		magenta: '#f48fb1',
		blue: '#90caf9',
		red: '#ef9a9a',
		darkblue: '#5c6bc0',
		darkcyan: '#26a69a',
		darkgreen: '#43a047',
		darkmagenta: '#ab47bc',
		darkred: '#e53935',
		darkyellow: '#f9a825',
		lightgray: '#e0e0e0',
		darkgray: '#757575',
		black: '#000000',
		white: '#ffffff',
		none: 'transparent'
	};

	let viewer: HTMLDivElement | null = null;
	let activeDocumentId: string | null = null;
	let activeDocumentName = '';
	let localError: string | null = null;
	let renderToken = 0;
	let releaseDoc: (() => void) | null = null;
	let browserDocxModulePromise: Promise<Docx4jsBrowserModule> | null = null;

	function localName(tag?: string): string {
		return tag?.split(':').pop()?.toLowerCase() ?? '';
	}

	function normalizeEditableText(raw: string): string {
		return raw.replace(/\u00a0/g, ' ').replace(/\r/g, '');
	}

	function toNumber(value: unknown): number | null {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function toTwipsPx(value: unknown): number | null {
		const parsed = toNumber(value);
		if (parsed == null) return null;
		return parsed / 15;
	}

	function toBorderPx(value: unknown): number | null {
		const parsed = toNumber(value);
		if (parsed == null) return null;
		return parsed / 6;
	}

	function getAttr(node: XmlNode | null | undefined, attr: string): string | undefined {
		const attribs =
			node &&
			typeof node === 'object' &&
			node.attribs &&
			typeof node.attribs === 'object' &&
			!Array.isArray(node.attribs)
				? node.attribs
				: null;

		if (!attribs) return undefined;
		if (attribs[attr] !== undefined) return attribs[attr];

		for (const [key, value] of Object.entries(attribs)) {
			if (localName(key) === localName(attr)) return value;
		}

		return undefined;
	}

	function findChild(node: XmlNode | null | undefined, name: string): XmlNode | undefined {
		return node?.children?.find((child) => localName(child.name) === name.toLowerCase());
	}

	function isOn(node?: XmlNode | null): boolean {
		if (!node) return false;
		const raw = (getAttr(node, 'val') ?? '').toLowerCase();
		return raw === '' || !['0', 'false', 'off', 'none', 'nil'].includes(raw);
	}

	function normalizeColor(raw?: string): string | null {
		if (!raw) return null;
		const value = raw.trim();
		if (!value || value.toLowerCase() === 'auto' || value.toLowerCase() === 'none') return null;
		if (value.startsWith('#')) return value;
		if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
		return value;
	}

	function setStyles(el: HTMLElement, styles: unknown) {
		if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return;
		for (const [key, value] of Object.entries(styles as Record<string, string | undefined | null>)) {
			if (value == null || value === '') continue;
			el.style.setProperty(key, value);
		}
	}

	function toNodeList(children: unknown): Node[] {
		if (children == null) return [];
		if (children instanceof Node) return [children];
		if (Array.isArray(children)) return children.flatMap((child) => toNodeList(child));
		if (typeof children === 'string' || typeof children === 'number') {
			return [document.createTextNode(String(children))];
		}
		return [];
	}

	function appendChildren(parent: Node, children: unknown) {
		for (const child of toNodeList(children)) {
			parent.appendChild(child);
		}
	}

	function resolveDocx4jsFromRequire(): Docx4jsBrowserModule | null {
		const maybeRequire = (
			globalThis as typeof globalThis & { require?: (moduleName: string) => unknown }
		).require;
		if (typeof maybeRequire !== 'function') return null;

		try {
			const mod = maybeRequire('docx4js') as Partial<Docx4jsBrowserModule> | undefined;
			if (mod?.docx?.load) return mod as Docx4jsBrowserModule;
		} catch {
			return null;
		}

		return null;
	}

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

	function hasOnlySectionBreak(pr?: XmlNode | null): boolean {
		if (!pr?.children || pr.children.length !== 1) return false;
		return localName(pr.children[0].name) === 'sectpr';
	}

	function getParagraphStyles(pr?: XmlNode | null): Record<string, string> {
		const style: Record<string, string> = {
			'margin-top': '0',
			'margin-bottom': '0',
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

		if (before != null) style['margin-top'] = `${before}px`;
		if (after != null) style['margin-bottom'] = `${after}px`;
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

		if (left != null) style['padding-left'] = `${left}px`;
		if (right != null) style['padding-right'] = `${right}px`;
		if (firstLine != null) style['text-indent'] = `${firstLine}px`;
		if (hanging != null) style['text-indent'] = `${-hanging}px`;

		return style;
	}

	function getRunStyles(pr?: XmlNode | null): Record<string, string> {
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
		if (fontSize != null) style['font-size'] = `${Math.max(fontSize / 2, 1)}pt`;

		const fontFamily =
			getAttr(fonts, 'ascii') ??
			getAttr(fonts, 'hAnsi') ??
			getAttr(fonts, 'eastAsia') ??
			getAttr(fonts, 'cs');
		if (fontFamily) style['font-family'] = `"${fontFamily}"`;

		const highlightKey = getAttr(highlight, 'val')?.toLowerCase();
		if (highlightKey) {
			style['background-color'] = highlightMap[highlightKey] ?? highlightKey;
		}

		return style;
	}

	function getSectionLayout(sectPr?: XmlNode | null) {
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

	function parseBorder(border?: XmlNode): string | null {
		if (!border) return null;
		const val = (getAttr(border, 'val') ?? 'single').toLowerCase();
		if (val === 'none' || val === 'nil') return 'none';

		const width = Math.max(toBorderPx(getAttr(border, 'sz')) ?? 0.5, 0.5);
		const color = normalizeColor(getAttr(border, 'color')) ?? '#000000';
		const cssType = val.includes('dot') ? 'dotted' : val.includes('dash') ? 'dashed' : 'solid';
		return `${width}px ${cssType} ${color}`;
	}

	function createRenderer(
		docId: string,
		onNodeUpsert: (node: ParagraphNode) => void,
		onNodeFocus: (node: ParagraphNode) => void
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
			element.classList.add(
				'rounded-sm',
				'-mx-1',
				'px-1',
				'outline-none',
				'focus:bg-sky-50/40',
				'focus:ring-2',
				'focus:ring-sky-300'
			);

			const syncText = () => {
				const text = normalizeEditableText(element.innerText ?? '');
				onNodeUpsert({ ...baseNode, text });
				return text;
			};

			element.addEventListener('input', () => {
				syncText();
			});

			element.addEventListener('focus', () => {
				const text = syncText();
				onNodeFocus({ ...baseNode, text });
			});

			syncText();
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
		if (clearStores) {
			paragraphs.set([]);
			selectedParagraph.set(null);
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
		selectedParagraph.set(null);

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
				nodesById.set(node.id, node);
				paragraphs.set(
					Array.from(nodesById.values()).sort((a, b) => a.paragraph_enum - b.paragraph_enum)
				);
			};
			const focusParagraphNode = (node: ParagraphNode) => {
				selectedParagraph.set(node);
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
				createRenderer(docId, upsertParagraphNode, focusParagraphNode),
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

<main class="flex min-h-screen flex-col bg-slate-200">
	<header class="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-300 bg-white/95 px-4 py-3 backdrop-blur">
		<button
			class="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
			on:click={() => goto('/')}
		>
			Back
		</button>

		<div>
			<div class="text-xs tracking-wide text-slate-500 uppercase">DOCX Editor</div>
			<div class="text-sm font-semibold text-slate-800">
				{activeDocumentName || 'No document selected'}
			</div>
		</div>

		<div class="ml-auto flex items-center gap-2">
			<div class="rounded border border-slate-300 bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
				Nodes: {$paragraphs.length}
			</div>
			{#if $selectedParagraph}
				<code class="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs text-sky-800">
					{$selectedParagraph.id}
				</code>
			{/if}
		</div>
	</header>

	{#if localError || $error}
		<div class="mx-4 mt-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
			{localError ?? $error}
		</div>
	{/if}

	<section class="flex-1 overflow-auto p-4">
		<div bind:this={viewer} class="min-h-full"></div>
	</section>
</main>
