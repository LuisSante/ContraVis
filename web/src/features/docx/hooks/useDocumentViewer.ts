'use client';

import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/document';
import { fetchDocumentFile, resolveDocumentMeta } from '@/services/documents';
import { getAxiosErrorMessage } from '@/features/docx/utils/http-error';
import { createRenderer } from '@/features/docx/utils/renderer';
import { loadBrowserDocx4js } from '@/features/docx/utils/docx-page';
import { ensureNodeEditState } from '@/features/docx/utils/edit';
import { appendChildren, normalizeEditableText } from '@/features/docx/utils/dom';
import { detectDocxNoiseNodeIds } from '@/features/docx/utils/noise';
import { applyDocxTabStops } from '@/features/docx/utils/tab-stops';
import { paginateRenderedSections } from '@/features/docx/utils/pagination';
import {
	clearRelationBadgeHost,
	freezeIgnoredParagraphElement,
} from '@/features/docx/utils/cleanup';
import type {
	Node as ParagraphNode,
	ParagraphEditState,
	XmlNode,
} from '@/types/document';

export type DocumentViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Ciclo de vida del visor docx: descarga el `.docx`, lo parsea con docx4js,
 * lo renderiza con `createRenderer` y monta el DOM resultante en un contenedor
 * gestionado por ref (React no controla esos hijos). Mantiene los mapas de nodos
 * como refs y sincroniza los párrafos al store Zustand.
 *
 * Alcance de este feature: render + store de párrafos + selección básica. Se
 * difieren: marcadores de contradicción, related, conectores de explicación y el
 * recompute del grafo al confirmar ediciones.
 */
export function useDocumentViewer(docId: string | null) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [status, setStatus] = useState<DocumentViewerStatus>('idle');
	const [documentName, setDocumentName] = useState<string | null>(null);
	// Se incrementa cada vez que termina un render: las features que decoran el
	// DOM (contradicciones, related…) dependen de él para re-aplicarse.
	const [renderEpoch, setRenderEpoch] = useState(0);

	// Mapas mutables del documento (refs: no deben provocar re-render).
	const nodeEditStateById = useRef(new Map<string, ParagraphEditState>());
	const paragraphElementById = useRef(new Map<string, HTMLElement>());
	const paragraphRelationHostById = useRef(new Map<string, HTMLElement>());
	const relationsCountByNodeId = useRef(new Map<string, number>());
	const nodesById = useRef(new Map<string, ParagraphNode>());
	const selectedNodeId = useRef<string | null>(null);

	const setParagraphs = useDocumentStore((s) => s.setParagraphs);
	const setSelectedParagraph = useDocumentStore((s) => s.setSelectedParagraph);
	const setLoading = useDocumentStore((s) => s.setLoading);
	const setError = useDocumentStore((s) => s.setError);

	useEffect(() => {
		if (!docId) return;

		const container = containerRef.current;
		let token = {};
		const renderToken = token;
		let releaseDoc: (() => void) | null = null;

		const maps = {
			nodeEditStateById: nodeEditStateById.current,
			paragraphElementById: paragraphElementById.current,
			paragraphRelationHostById: paragraphRelationHostById.current,
			relationsCountByNodeId: relationsCountByNodeId.current,
			nodes: nodesById.current,
		};

		const resetMaps = () => {
			maps.nodeEditStateById.clear();
			maps.paragraphElementById.clear();
			maps.paragraphRelationHostById.clear();
			maps.relationsCountByNodeId.clear();
			maps.nodes.clear();
			selectedNodeId.current = null;
		};

		const syncParagraphNodeStore = () => {
			setParagraphs(
				Array.from(maps.nodes.values()).sort(
					(left, right) => left.paragraph_enum - right.paragraph_enum
				)
			);
		};

		const removeParagraphNode = (
			nodeId: string,
			options: { freezeElement?: boolean; deferStoreSync?: boolean } = {}
		): boolean => {
			const paragraphElement = maps.paragraphElementById.get(nodeId);
			if (options.freezeElement && paragraphElement) {
				freezeIgnoredParagraphElement(paragraphElement);
			}

			const relationHost = maps.paragraphRelationHostById.get(nodeId);
			if (relationHost) clearRelationBadgeHost(relationHost);

			maps.nodeEditStateById.delete(nodeId);
			maps.paragraphElementById.delete(nodeId);
			maps.paragraphRelationHostById.delete(nodeId);
			maps.relationsCountByNodeId.delete(nodeId);

			const removed = maps.nodes.delete(nodeId);
			if (selectedNodeId.current === nodeId) {
				selectedNodeId.current = null;
				setSelectedParagraph(null);
			}

			if (removed && !options.deferStoreSync) syncParagraphNodeStore();
			return removed;
		};

		const pruneBlankSections = (viewer: HTMLElement) => {
			const root = viewer.firstElementChild;
			if (!(root instanceof HTMLElement)) return;

			const sections = Array.from(root.children).filter(
				(node): node is HTMLElement =>
					node instanceof HTMLElement && node.tagName.toLowerCase() === 'section'
			);
			if (sections.length === 0) return;

			let removedAnyNode = false;
			for (const section of sections) {
				const hasMediaContent = Boolean(
					section.querySelector('img,table,svg,canvas,video,audio,object,iframe')
				);
				const visibleText = normalizeEditableText(section.innerText ?? '').trim();
				if (hasMediaContent || visibleText.length > 0) continue;

				const nodeElements = section.querySelectorAll<HTMLElement>('[data-node-id]');
				for (const nodeElement of nodeElements) {
					const nodeId = nodeElement.dataset.nodeId;
					if (!nodeId) continue;
					const removed = removeParagraphNode(nodeId, {
						freezeElement: true,
						deferStoreSync: true,
					});
					removedAnyNode = removedAnyNode || removed;
				}
				section.remove();
			}

			if (removedAnyNode) syncParagraphNodeStore();
		};

		const upsertParagraphNode = (node: ParagraphNode) => {
			const state = ensureNodeEditState(maps.nodeEditStateById, node.id, node.text);
			state.current = normalizeEditableText(node.text);
			maps.nodes.set(node.id, node);
			syncParagraphNodeStore();
		};

		const focusParagraphNode = (node: ParagraphNode) => {
			selectedNodeId.current = node.id;
			setSelectedParagraph(node);
		};

		const commitParagraphNode = (node: ParagraphNode) => {
			const state = ensureNodeEditState(maps.nodeEditStateById, node.id, node.text);
			state.current = normalizeEditableText(node.text);
			state.committed = state.current;
			state.editedSinceCommit = false;
			if (selectedNodeId.current === node.id) setSelectedParagraph(node);
			// TODO: recompute del grafo de relaciones (feature posterior).
		};

		const run = async () => {
			setStatus('loading');
			setLoading(true);
			setError(null);
			resetMaps();

			try {
				const metadata = await resolveDocumentMeta(docId);
				if (token !== renderToken) return;
				setDocumentName(metadata?.display_name || metadata?.name || `${docId}.docx`);

				const buffer = await fetchDocumentFile(docId);
				if (token !== renderToken) return;

				const docx4jsModule = await loadBrowserDocx4js();
				if (token !== renderToken) return;

				const parsedDoc = await docx4jsModule.docx.load(buffer);
				if (token !== renderToken) {
					parsedDoc.release?.();
					return;
				}
				releaseDoc =
					typeof parsedDoc.release === 'function' ? () => parsedDoc.release?.() : null;

				const identify = (
					node: XmlNode,
					officeDocument: {
						constructor: { identify: (node: XmlNode, officeDocument: unknown) => unknown };
					}
				) => officeDocument.constructor.identify(node, officeDocument);

				type DocxOfficeDocument = {
					renderNode: (
						node: XmlNode,
						createElement: ReturnType<typeof createRenderer>,
						identifyNode: typeof identify
					) => unknown;
				};
				type DocxPartQuery = { children: () => { toArray: () => XmlNode[] } };
				type DocxPart = (selector: string) => DocxPartQuery;

				const officeDocument = (
					parsedDoc as typeof parsedDoc & { officeDocument?: DocxOfficeDocument }
				).officeDocument;

				// `let` intencional: `renderExternalPart` referencia `renderer` antes de
				// asignarlo (se invoca durante render(), ya con renderer definido).
				// eslint-disable-next-line prefer-const
				let renderer: ReturnType<typeof createRenderer>;
				const renderExternalPart = (part: unknown, rootLocalName: 'hdr' | 'ftr') => {
					if (!officeDocument || typeof part !== 'function') return null;
					const root = (part as DocxPart)(`w\\:${rootLocalName}`);
					const nodes = root.children().toArray();
					return nodes.map((node) => officeDocument.renderNode(node, renderer, identify));
				};

				renderer = createRenderer(
					docId,
					{
						onNodeUpsert: upsertParagraphNode,
						onNodeFocus: focusParagraphNode,
						onNodeCommit: commitParagraphNode,
						onNodeRemove: (nodeId: string) => {
							removeParagraphNode(nodeId);
						},
					},
					{
						nodeEditStateById: maps.nodeEditStateById,
						paragraphElementById: maps.paragraphElementById,
						paragraphRelationHostById: maps.paragraphRelationHostById,
						relationsCountByNodeId: maps.relationsCountByNodeId,
						getSelectedNodeId: () => selectedNodeId.current,
					},
					{ renderExternalPart }
				);

				const renderedRoot = parsedDoc.render(renderer, identify);
				const viewer = containerRef.current;
				if (token !== renderToken || !viewer) return;

				viewer.replaceChildren();
				appendChildren(viewer, renderedRoot);

				if (document.fonts?.status !== 'loaded') {
					await document.fonts.ready;
					if (token !== renderToken || !containerRef.current) return;
				}

				applyDocxTabStops(viewer);
				paginateRenderedSections(viewer);
				pruneBlankSections(viewer);

				const noiseNodeIds = detectDocxNoiseNodeIds(viewer);
				if (noiseNodeIds.length > 0) {
					let removedAny = false;
					for (const nodeId of noiseNodeIds) {
						removedAny = removeParagraphNode(nodeId, { deferStoreSync: true }) || removedAny;
					}
					if (removedAny) syncParagraphNodeStore();
				}

				setStatus('ready');
				setRenderEpoch((epoch) => epoch + 1);
			} catch (err) {
				if (token !== renderToken) return;
				console.error('DOCX load error:', err);
				setError(getAxiosErrorMessage(err, 'Could not render the document.'));
				setStatus('error');
			} finally {
				if (token === renderToken) setLoading(false);
			}
		};

		void run();

		return () => {
			token = {};
			releaseDoc?.();
			releaseDoc = null;
			container?.replaceChildren();
		};
	}, [docId, setParagraphs, setSelectedParagraph, setLoading, setError]);

	return {
		containerRef,
		status,
		documentName,
		renderEpoch,
		// Mapas vivos del documento (refs); las features de decoración los leen.
		maps: {
			nodeEditStateById,
			paragraphElementById,
			paragraphRelationHostById,
			relationsCountByNodeId,
			nodesById,
			selectedNodeId,
		},
	};
}

export type DocumentViewerMaps = ReturnType<typeof useDocumentViewer>['maps'];
