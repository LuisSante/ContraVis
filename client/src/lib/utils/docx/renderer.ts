import type {
	Node as ParagraphNode,
	ParagraphEditState,
	ParagraphKind,
	XmlNode
} from '$lib/types/document';
import { ensureNodeEditState } from '$lib/utils/edit';
import { getRelationsCount, updateRelationBadge } from '$lib/utils/docx-page';
import { appendChildren, normalizeEditableText, setStyles, toNodeList } from '$lib/utils/docx/dom';
import { getAttr, findChild, toTwipsPx, toNumber } from '$lib/utils/docx/xml';
import {
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
	const { onNodeUpsert, onNodeFocus, onNodeCommit } = callbacks;
	const {
		nodeEditStateById,
		paragraphElementById,
		paragraphRelationHostById,
		relationsCountByNodeId,
		getSelectedNodeId
	} = deps;

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

	const attachParagraphEditor = (
		element: HTMLElement,
		kind: ParagraphKind,
		relationHost: HTMLElement = element
	) => {
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
		updateRelationBadge(paragraphRelationHostById, relationsCountByNodeId, nodeId, relationHost);
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
			const node = {
				...baseNode,
				text,
				relationsCount: getRelationsCount(relationsCountByNodeId, nodeId)
			};
			onNodeUpsert(node);
			return node;
		};

		element.addEventListener('input', () => {
			const state = ensureNodeEditState(nodeEditStateById, nodeId, element.innerText ?? '');
			state.editedSinceCommit = true;
			const node = syncText();
			if (getSelectedNodeId() === node.id || document.activeElement === element) {
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
		if (getSelectedNodeId() === node.id) {
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
					attachParagraphEditor(content, 'list', item);
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
