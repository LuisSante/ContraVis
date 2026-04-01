import type {
	Node as ParagraphNode,
	ParagraphEditState,
	ParagraphKind,
	XmlNode
} from '$lib/types/document';
import { ensureNodeEditState } from '$lib/utils/edit';
import { getRelationsCount, updateRelationBadge } from '$lib/utils/docx-page';
import { appendChildren, normalizeEditableText, setStyles, toNodeList } from '$lib/utils/docx/dom';
import { getAttr, findChild, localName, toTwipsPx, toNumber } from '$lib/utils/docx/xml';
import {
	getParagraphStyleId,
	getParagraphStyles,
	getRunStyles,
	getSectionLayout,
	hasOnlySectionBreak,
	parseBorder
} from '$lib/utils/docx/styles';

export type DocxRendererCallbacks = {
	onNodeUpsert: (node: ParagraphNode) => void;
	onNodeFocus: (node: ParagraphNode) => void;
	onNodeCommit: (node: ParagraphNode) => void;
	onNodeRemove: (nodeId: string) => void;
};

export type DocxRendererDeps = {
	nodeEditStateById: Map<string, ParagraphEditState>;
	paragraphElementById: Map<string, HTMLElement>;
	paragraphRelationHostById: Map<string, HTMLElement>;
	relationsCountByNodeId: Map<string, number>;
	getSelectedNodeId: () => string | null;
};

export function createRenderer(
	docId: string,
	callbacks: DocxRendererCallbacks,
	deps: DocxRendererDeps
) {
	const { onNodeUpsert, onNodeFocus, onNodeCommit, onNodeRemove } = callbacks;
	const {
		nodeEditStateById,
		paragraphElementById,
		paragraphRelationHostById,
		relationsCountByNodeId,
		getSelectedNodeId
	} = deps;

	type ListLevelDefinition = {
		numFmt: string;
		lvlText: string;
		start: number;
	};
	type ParagraphStyleDefinition = {
		basedOn: string | null;
		runPr: XmlNode | null;
	};

	const listState = new Map<string, number[]>();
	const listDefinitionsByNumId = new Map<string, Map<number, ListLevelDefinition>>();
	const paragraphStyleDefinitionsById = new Map<string, ParagraphStyleDefinition>();
	const paragraphRunStyleCache = new Map<string, Record<string, string>>();
	let defaultRunPr: XmlNode | null = null;
	let paragraphCounter = 0;
	const htmlEntityDecoder = document.createElement('textarea');
	const INTERACTIVE_PARAGRAPH_CLASSES = [
		'rounded-[2px]',
		'-mx-[2px]',
		'px-[2px]',
		'outline-none',
		'transition-all',
		'hover:ring-1',
		'hover:ring-blue-300',
		'focus:ring-2',
		'focus:ring-yellow-400'
	] as const;
	const ENTITY_RE = /&(?:#\d+|#x[\da-f]+|[a-z][\w-]+);/i;

	const decodeDocxText = (value: string): string => {
		if (!value.includes('&') || !ENTITY_RE.test(value)) return value;

		let decoded = value;
		for (let i = 0; i < 2; i += 1) {
			htmlEntityDecoder.innerHTML = decoded;
			const next = htmlEntityDecoder.value;
			if (!next || next === decoded) break;
			decoded = next;
		}
		return decoded;
	};

	const toAlphabetic = (value: number, uppercase: boolean): string => {
		if (value <= 0 || !Number.isFinite(value)) return String(value);
		let remaining = Math.trunc(value);
		let output = '';
		const base = uppercase ? 65 : 97;
		while (remaining > 0) {
			remaining -= 1;
			output = String.fromCharCode(base + (remaining % 26)) + output;
			remaining = Math.floor(remaining / 26);
		}
		return output;
	};

	const toRoman = (value: number, uppercase: boolean): string => {
		if (value <= 0 || !Number.isFinite(value)) return String(value);
		const table: Array<[number, string]> = [
			[1000, 'M'],
			[900, 'CM'],
			[500, 'D'],
			[400, 'CD'],
			[100, 'C'],
			[90, 'XC'],
			[50, 'L'],
			[40, 'XL'],
			[10, 'X'],
			[9, 'IX'],
			[5, 'V'],
			[4, 'IV'],
			[1, 'I']
		];
		let remaining = Math.trunc(value);
		let output = '';
		for (const [step, symbol] of table) {
			while (remaining >= step) {
				output += symbol;
				remaining -= step;
			}
		}
		return uppercase ? output : output.toLowerCase();
	};

	const formatCounter = (value: number, numFmt: string): string => {
		switch (numFmt.toLowerCase()) {
			case 'upperletter':
				return toAlphabetic(value, true);
			case 'lowerletter':
				return toAlphabetic(value, false);
			case 'upperroman':
				return toRoman(value, true);
			case 'lowerroman':
				return toRoman(value, false);
			case 'decimalzero':
				return String(value).padStart(2, '0');
			default:
				return String(value);
		}
	};

	const parseStylesNode = (stylesNode?: XmlNode | null) => {
		defaultRunPr = null;
		paragraphStyleDefinitionsById.clear();
		paragraphRunStyleCache.clear();
		if (!stylesNode?.children) return;

		const docDefaults = stylesNode.children.find((child) => localName(child.name) === 'docdefaults');
		const rPrDefault = findChild(docDefaults, 'rprdefault');
		const runDefaults = findChild(rPrDefault, 'rpr');
		if (runDefaults) {
			defaultRunPr = runDefaults;
		}

		for (const child of stylesNode.children) {
			if (localName(child.name) !== 'style') continue;
			if ((getAttr(child, 'type') ?? '').toLowerCase() !== 'paragraph') continue;
			const styleId = getAttr(child, 'styleId');
			if (!styleId) continue;
			const basedOn = getAttr(findChild(child, 'basedon'), 'val') ?? null;
			const runPr = findChild(child, 'rpr') ?? null;
			paragraphStyleDefinitionsById.set(styleId, { basedOn, runPr });
		}
	};

	const parseNumberingNode = (numberingNode?: XmlNode | null) => {
		listState.clear();
		listDefinitionsByNumId.clear();
		if (!numberingNode?.children) return;

		const abstractLevelsById = new Map<string, Map<number, ListLevelDefinition>>();
		const numNodesById = new Map<string, XmlNode>();

		for (const child of numberingNode.children) {
			const tag = localName(child.name);

			if (tag === 'abstractnum') {
				const abstractId = getAttr(child, 'abstractNumId');
				if (!abstractId) continue;
				const levels = new Map<number, ListLevelDefinition>();
				for (const levelNode of child.children ?? []) {
					if (localName(levelNode.name) !== 'lvl') continue;
					const rawLevel = toNumber(getAttr(levelNode, 'ilvl'));
					const level = rawLevel != null ? Math.max(Math.trunc(rawLevel), 0) : 0;
					const numFmt = getAttr(findChild(levelNode, 'numfmt'), 'val') ?? 'decimal';
					const lvlText = decodeDocxText(
						getAttr(findChild(levelNode, 'lvltext'), 'val') ?? `%${level + 1}`
					);
					const rawStart = toNumber(getAttr(findChild(levelNode, 'start'), 'val'));
					const start = rawStart != null ? Math.trunc(rawStart) : 1;
					levels.set(level, { numFmt, lvlText, start });
				}
				abstractLevelsById.set(abstractId, levels);
				continue;
			}

			if (tag === 'num') {
				const numId = getAttr(child, 'numId');
				if (!numId) continue;
				numNodesById.set(numId, child);
			}
		}

		for (const [numId, numNode] of numNodesById.entries()) {
			const abstractId = getAttr(findChild(numNode, 'abstractNumId'), 'val');
			const baseLevels = abstractId ? abstractLevelsById.get(abstractId) : undefined;
			const resolvedLevels = new Map<number, ListLevelDefinition>();
			for (const [level, levelDef] of baseLevels?.entries() ?? []) {
				resolvedLevels.set(level, { ...levelDef });
			}

			for (const overrideNode of numNode.children ?? []) {
				if (localName(overrideNode.name) !== 'lvloverride') continue;
				const rawLevel = toNumber(getAttr(overrideNode, 'ilvl'));
				const level = rawLevel != null ? Math.max(Math.trunc(rawLevel), 0) : 0;
				const existingLevel = resolvedLevels.get(level) ?? {
					numFmt: 'decimal',
					lvlText: `%${level + 1}`,
					start: 1
				};
				const mergedLevel = { ...existingLevel };

				const startOverrideRaw = toNumber(getAttr(findChild(overrideNode, 'startoverride'), 'val'));
				if (startOverrideRaw != null) {
					mergedLevel.start = Math.trunc(startOverrideRaw);
				}

				const inlineLevel = findChild(overrideNode, 'lvl');
				if (inlineLevel) {
					const numFmt = getAttr(findChild(inlineLevel, 'numfmt'), 'val');
					const lvlText = getAttr(findChild(inlineLevel, 'lvltext'), 'val');
					const startRaw = toNumber(getAttr(findChild(inlineLevel, 'start'), 'val'));

					if (numFmt) mergedLevel.numFmt = numFmt;
					if (lvlText != null) mergedLevel.lvlText = decodeDocxText(lvlText);
					if (startRaw != null) mergedLevel.start = Math.trunc(startRaw);
				}

				resolvedLevels.set(level, mergedLevel);
			}

			if (resolvedLevels.size > 0) {
				listDefinitionsByNumId.set(numId, resolvedLevels);
			}
		}
	};

	const getParagraphInheritedRunStyles = (pr?: XmlNode | null): Record<string, string> => {
		const styleId = getParagraphStyleId(pr) ?? '__default__';
		const cached = paragraphRunStyleCache.get(styleId);
		if (cached) return cached;

		const inherited: Record<string, string> = {};
		if (defaultRunPr) {
			Object.assign(inherited, getRunStyles(defaultRunPr));
		}

		const visited = new Set<string>();
		const applyStyleChain = (id: string | null) => {
			if (!id || visited.has(id)) return;
			visited.add(id);
			const styleDef = paragraphStyleDefinitionsById.get(id);
			if (!styleDef) return;
			applyStyleChain(styleDef.basedOn);
			if (styleDef.runPr) {
				Object.assign(inherited, getRunStyles(styleDef.runPr));
			}
		};
		applyStyleChain(styleId === '__default__' ? null : styleId);

		paragraphRunStyleCache.set(styleId, inherited);
		return inherited;
	};

	const getParagraphTabStopsPx = (pr?: XmlNode | null): number[] => {
		const tabsNode = findChild(pr, 'tabs');
		if (!tabsNode?.children) return [];
		const stops: number[] = [];
		for (const child of tabsNode.children) {
			if (localName(child.name) !== 'tab') continue;
			const posPx = toTwipsPx(getAttr(child, 'pos'));
			if (posPx == null || posPx < 0) continue;
			stops.push(posPx);
		}
		stops.sort((left, right) => left - right);
		return stops;
	};

	const applyParagraphTabStopMetadata = (element: HTMLElement, pr?: XmlNode | null) => {
		const stops = getParagraphTabStopsPx(pr);
		if (stops.length === 0) {
			delete element.dataset.docxTabStops;
			return;
		}
		element.dataset.docxTabStops = stops.map((stop) => `${Math.round(stop * 100) / 100}`).join(',');
	};

	const nextListMarker = (numId: string | undefined, level: number): string => {
		if (!numId) return '•';
		const key = String(numId);
		const counters = listState.get(key) ?? [];
		const levels = listDefinitionsByNumId.get(key);
		const levelDef = levels?.get(level);
		const start = levelDef?.start ?? 1;
		counters[level] = (counters[level] ?? start - 1) + 1;
		counters.length = level + 1;
		listState.set(key, counters);

		if (!levelDef) return `${counters[level]}.`;
		if (levelDef.numFmt.toLowerCase() === 'bullet') return levelDef.lvlText || '•';

		const marker = (levelDef.lvlText || `%${level + 1}`).replace(/%(\d+)/g, (_, rawIndex: string) => {
			const levelIndex = Math.max(Number(rawIndex) - 1, 0);
			const referencedLevel = levels?.get(levelIndex);
			const levelValue = counters[levelIndex] ?? referencedLevel?.start ?? 1;
			const numberFormat = referencedLevel?.numFmt ?? levelDef.numFmt;
			return formatCounter(levelValue, numberFormat);
		});

		return marker || `${formatCounter(counters[level], levelDef.numFmt)}.`;
	};

	const clearRelationBadge = (host: HTMLElement) => {
		host.classList.remove('docx-relations-badge-host');
		delete host.dataset.relationsCount;
		delete host.dataset.relationsTone;
	};

	const isHeaderOrFooterStyle = (pr?: XmlNode | null): boolean => {
		const styleId = getParagraphStyleId(pr)?.toLowerCase();
		if (!styleId) return false;
		return styleId.includes('header') || styleId.includes('footer');
	};

	const attachParagraphEditor = (
		element: HTMLElement,
		kind: ParagraphKind,
		relationHost: HTMLElement = element,
		options: { disabled?: boolean } = {}
	) => {
		if (options.disabled) {
			element.dataset.ignoredParagraph = 'true';
			element.setAttribute('contenteditable', 'false');
			element.setAttribute('spellcheck', 'false');
			return;
		}

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
		paragraphRelationHostById.set(nodeId, relationHost);
		element.classList.add(...INTERACTIVE_PARAGRAPH_CLASSES);

		let hasNodeInStore = false;

		const syncText = (): ParagraphNode | null => {
			const text = normalizeEditableText(element.innerText ?? '').trim();
			if (!text) {
				if (hasNodeInStore) {
					onNodeRemove(nodeId);
					hasNodeInStore = false;
				}
				clearRelationBadge(relationHost);
				return null;
			}

			updateRelationBadge(paragraphRelationHostById, relationsCountByNodeId, nodeId, relationHost);
			const node = {
				...baseNode,
				text,
				relationsCount: getRelationsCount(relationsCountByNodeId, nodeId)
			};
			onNodeUpsert(node);
			hasNodeInStore = true;
			return node;
		};

		element.addEventListener('input', () => {
			const state = ensureNodeEditState(nodeEditStateById, nodeId, element.innerText ?? '');
			state.editedSinceCommit = true;
			const node = syncText();
			if (!node) return;
			if (getSelectedNodeId() === node.id || document.activeElement === element) {
				onNodeFocus(node);
			}
		});

		element.addEventListener('focus', () => {
			const node = syncText();
			if (!node) return;
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
			if (!node) return;
			onNodeCommit(node);
		});

		const node = syncText();
		if (node && getSelectedNodeId() === node.id) {
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
				case 'styles': {
					parseStylesNode((safeProps.node as XmlNode) ?? null);
					return document.createDocumentFragment();
				}
				case 'numbering': {
					parseNumberingNode((safeProps.node as XmlNode) ?? null);
					return document.createDocumentFragment();
				}
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
					section.style.height = `${layout.height}px`;
					section.style.minHeight = `${layout.height}px`;
					section.style.padding = `${layout.marginTop}px ${layout.marginRight}px ${layout.marginBottom}px ${layout.marginLeft}px`;
					appendChildren(section, children);
					return section;
				}
				case 'heading': {
					const level = Math.min(Math.max(toNumber(safeProps.outline) ?? 1, 1), 6);
					const pr = (safeProps.pr as XmlNode) ?? null;
					const heading = document.createElement(`h${level}`);
					heading.className = 'font-bold whitespace-pre-wrap break-words [tab-size:4]';
					setStyles(heading, getParagraphStyles(pr));
					setStyles(heading, getParagraphInheritedRunStyles(pr));
					applyParagraphTabStopMetadata(heading, pr);
					appendChildren(heading, children);
					attachParagraphEditor(heading, 'heading', heading, {
						disabled: isHeaderOrFooterStyle(pr)
					});
					return heading;
				}
				case 'list': {
					const item = document.createElement('p');
					item.dataset.docxListItem = 'true';
					item.className = 'grid items-start whitespace-pre-wrap break-words [tab-size:4]';
					item.style.gridTemplateColumns = 'max-content minmax(0, 1fr)';
					item.style.columnGap = '4px';
					const level = Math.max(toNumber(safeProps.level) ?? 0, 0);
					const pr = (safeProps.pr as XmlNode) ?? null;

					const marker = document.createElement('span');
					marker.className = 'shrink-0 text-right whitespace-nowrap';
					marker.textContent = nextListMarker(
						typeof safeProps.numId === 'string' ? safeProps.numId : undefined,
						level
					);
					marker.style.whiteSpace = 'nowrap';
					marker.style.overflow = 'visible';
					marker.style.fontSize = '0.74em';
					marker.style.fontWeight = '400';
					marker.style.lineHeight = 'inherit';
					marker.style.display = 'inline-block';
					marker.setAttribute('contenteditable', 'false');

					const content = document.createElement('span');
					content.className = 'block min-w-0 flex-1 whitespace-pre-wrap break-words [tab-size:4]';
					appendChildren(content, children);

					setStyles(item, getParagraphStyles(pr));
					setStyles(item, getParagraphInheritedRunStyles(pr));
					applyParagraphTabStopMetadata(item, pr);
					item.style.textIndent = '0';

					const indent = findChild(pr, 'ind');
					const leftIndent = toTwipsPx(getAttr(indent, 'left'));
					const hangingIndent = toTwipsPx(getAttr(indent, 'hanging'));
					if (leftIndent != null && hangingIndent != null && hangingIndent > 0) {
						item.style.paddingLeft = `${Math.max(leftIndent - hangingIndent, 0)}px`;
						item.style.columnGap = `${Math.min(Math.max(hangingIndent * 0.22, 2), 8)}px`;
					}
					if (!item.style.paddingLeft) item.style.paddingLeft = `${(level + 1) * 18}px`;

					item.appendChild(marker);
					item.appendChild(content);
					attachParagraphEditor(content, 'list', item, {
						disabled: isHeaderOrFooterStyle(pr)
					});
					return item;
				}
				case 'p': {
					const paragraph = document.createElement('p');
					const pr = (safeProps.pr as XmlNode) ?? null;
					paragraph.className = 'whitespace-pre-wrap break-words [tab-size:4]';
					setStyles(paragraph, getParagraphStyles(pr));
					setStyles(paragraph, getParagraphInheritedRunStyles(pr));
					applyParagraphTabStopMetadata(paragraph, pr);
					if (hasOnlySectionBreak(pr) && toNodeList(children).length === 0) {
						paragraph.classList.add('min-h-[1px]');
					}
					appendChildren(paragraph, children);
					attachParagraphEditor(paragraph, 'paragraph', paragraph, {
						disabled: isHeaderOrFooterStyle(pr)
					});
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
						decodeDocxText(
							toNodeList(children)
								.map((n) => n.textContent ?? '')
								.join('')
						)
					);
				case 'tab': {
					const tab = document.createElement('span');
					tab.dataset.docxTab = '1';
					tab.style.display = 'inline-block';
					tab.style.minWidth = '1ch';
					tab.style.width = '1ch';
					tab.style.verticalAlign = 'baseline';
					tab.textContent = '\u00a0';
					return tab;
				}
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
					table.className = 'my-1 border-collapse';
					const tblPr = safeProps.pr as XmlNode | undefined;
					const width = findChild(tblPr, 'tblw');
					const widthValue = toNumber(getAttr(width, 'w'));
					const widthType = getAttr(width, 'type')?.toLowerCase();
					if (widthValue != null && widthType === 'dxa') {
						table.style.width = `${toTwipsPx(widthValue) ?? widthValue}px`;
					}
					const cols = Array.isArray(safeProps.cols) ? (safeProps.cols as XmlNode[]) : [];
					if (cols.length > 0) {
						const colgroup = document.createElement('colgroup');
						for (const colNode of cols) {
							const col = document.createElement('col');
							const colWidth = toNumber(getAttr(colNode, 'w'));
							if (colWidth != null) {
								col.style.width = `${toTwipsPx(colWidth) ?? colWidth}px`;
							}
							colgroup.appendChild(col);
						}
						table.style.tableLayout = 'fixed';
						table.appendChild(colgroup);
					} else {
						table.style.tableLayout = 'auto';
						table.style.width = table.style.width || '100%';
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
					cell.className = 'align-top';
					const tcPr = safeProps.pr as XmlNode | undefined;
					const cellWidthNode = findChild(tcPr, 'tcw');
					const cellWidthRaw = toNumber(getAttr(cellWidthNode, 'w'));
					const cellWidthType = getAttr(cellWidthNode, 'type')?.toLowerCase();
					if (cellWidthRaw != null) {
						if (cellWidthType === 'dxa') {
							cell.style.width = `${toTwipsPx(cellWidthRaw) ?? cellWidthRaw}px`;
						}
						if (cellWidthType === 'pct') {
							cell.style.width = `${cellWidthRaw / 50}%`;
						}
					}
					const gridSpan = toNumber(getAttr(findChild(tcPr, 'gridspan'), 'val'));
					if (gridSpan != null && gridSpan > 1) {
						cell.colSpan = Math.trunc(gridSpan);
					}
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
