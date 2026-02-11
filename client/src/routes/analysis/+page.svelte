<script lang="ts">
	import { onDestroy } from 'svelte';
	import * as pdfjsLib from 'pdfjs-dist';
	// @ts-ignore
	import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import { selectedParagraph, paragraphs, relations, pdfUrl } from '$lib/stores/document';
	import type { Paragraph, ParagraphRelation } from '$lib/types/document';
	import { api } from '$lib/api/client';

	pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

	const scale = 1.5;

	let loading = false;
	let error: string | null = null;
	let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
	let pages: number[] = [];
	let loadTask: any = null;
	let pageNodes: (HTMLCanvasElement | null)[] = [];

	$: if ($pdfUrl) {
		loadDocument($pdfUrl);
	}

	function drawBoundingBoxes(pageNum: number) {
		const canvas = pageNodes[pageNum - 1];
		if (!canvas || !pdfDoc) return;
		const context = canvas.getContext('2d');
		if (!context) return;

		$paragraphs.forEach((p) => {
			if (p.page === pageNum) {
				const [x1, y1, x2, y2] = p.bbox;

				if ($selectedParagraph && $selectedParagraph.id === p.id) {
					context.strokeStyle = 'rgba(255, 215, 0, 1)';
					context.lineWidth = 2;
				} else {
					context.strokeStyle = 'rgba(0, 0, 255, 0.5)';
					context.lineWidth = 1;
				}
				context.strokeRect(x1 * scale, y1 * scale, (x2 - x1) * scale, (y2 - y1) * scale);

				if (p.relationsCount > 0) {
					const text = p.relationsCount.toString();
					context.font = 'bold 16px Arial';
					const textWidth = context.measureText(text).width;
					const bgPadding = 8;
					const boxHeight = 26;
					const boxX = x2 * scale + 2;
					const boxY = y1 * scale;

					context.fillStyle = 'rgba(255, 0, 0, 0.7)';
					context.fillRect(boxX, boxY, textWidth + bgPadding * 2, boxHeight);

					context.fillStyle = 'white';
					context.textBaseline = 'middle';
					context.fillText(text, boxX + bgPadding, boxY + boxHeight / 2);
				}
			}
		});
	}

	async function loadDocument(url: string) {
		loading = true;
		error = null;
		pdfDoc = null;
		pages = [];
		try {
			if (loadTask) loadTask.destroy();
			loadTask = pdfjsLib.getDocument(url);
			pdfDoc = await loadTask.promise;
			if (pdfDoc) pages = Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
		} catch (err: any) {
			if (err.name !== 'RenderingCancelledException') {
				console.error('Error loading PDF:', err);
				error = 'Failed to load PDF';
			}
		} finally {
			loading = false;
		}
	}

	function handlePageClick(event: MouseEvent, pageNum: number) {
		const canvas = pageNodes[pageNum - 1];
		if (!canvas) return;
		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		const clickedParagraph = $paragraphs.find((p) => {
			if (p.page !== pageNum) return false;
			const [x1, y1, x2, y2] = p.bbox;
			return x >= x1 * scale && x <= x2 * scale && y >= y1 * scale && y <= y2 * scale;
		});
		if (clickedParagraph) $selectedParagraph = clickedParagraph;
	}

	function renderPage(node: HTMLCanvasElement, pageNum: number) {
		let renderTask: any = null;
		pageNodes[pageNum - 1] = node;
		async function render() {
			if (!pdfDoc) return;
			try {
				const page = await pdfDoc.getPage(pageNum);
				const viewport = page.getViewport({ scale: scale });
				node.height = viewport.height;
				node.width = viewport.width;
				const context = node.getContext('2d');
				if (context) {
					renderTask = page.render({ canvasContext: context, viewport: viewport } as any);
					await renderTask.promise;
					drawBoundingBoxes(pageNum);
				}
			} catch (err: any) {
				if (err.name !== 'RenderingCancelledException')
					console.error(`Error rendering page ${pageNum}:`, err);
			}
		}
		render();
		return {
			update() {
				render();
			},
			destroy() {
				if (renderTask) renderTask.cancel();
			}
		};
	}

	$: if ($selectedParagraph && pageNodes.length > 0) {
		pages.forEach((pageNum) => {
			const canvas = pageNodes[pageNum - 1];
			if (canvas) {
				const context = canvas.getContext('2d');
				if (context && pdfDoc) {
					pdfDoc.getPage(pageNum).then((page) => {
						const viewport = page.getViewport({ scale: scale });
						page.render({ canvasContext: context, viewport: viewport } as any).promise.then(() => {
							drawBoundingBoxes(pageNum);
						});
					});
				}
			}
		});
	}

	onDestroy(() => {
		if (loadTask) loadTask.destroy();
	});

	let relatedParagraphs: (Paragraph & { relationType: 'reference' | 'semantic_similarity' })[] = [];

	function fetchRelatedParagraphs(
		paragraph: Paragraph | null,
		allParagraphs: Paragraph[],
		allRelations: ParagraphRelation[]
	) {
		if (!paragraph) {
			relatedParagraphs = [];
			return;
		}
		relatedParagraphs = allRelations
			.filter((r) => r.source === paragraph.id || r.target === paragraph.id)
			.map((r) => {
				const targetId = r.source === paragraph.id ? r.target : r.source;
				const targetParagraph = allParagraphs.find((p) => p.id === targetId);
				return targetParagraph ? { ...targetParagraph, relationType: r.type } : null;
			})
			.filter(
				(p): p is Paragraph & { relationType: 'reference' | 'semantic_similarity' } => p !== null
			);
	}

	$: fetchRelatedParagraphs($selectedParagraph, $paragraphs, $relations);
</script>

<main class="box-border flex h-screen w-full gap-4 bg-gray-100 p-4">
	<div
		class="flex flex-1 flex-col overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm"
	>
		<div class="h-full w-full overflow-auto bg-gray-200 shadow-inner">
			<div class="relative flex flex-col items-center gap-8 p-2">
				{#if pdfDoc}
					{#each pages as pageNum (pageNum)}
						<div class="relative border border-gray-300 bg-white shadow-2xl">
							<canvas
								use:renderPage={pageNum}
								on:click={(e) => handlePageClick(e, pageNum)}
								class="block"
							></canvas>
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>

	<div class="flex flex-1 flex-col gap-4 overflow-hidden">
		<div
			class="flex flex-1 flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
		>
			{#if !$selectedParagraph}
				<div class="flex h-full items-center justify-center text-center text-gray-400 italic">
					Select a paragraph in the PDF to view its relationships.
				</div>
			{:else}
				<div class="mb-2">
					<h3 class="mb-4 border-b pb-2 text-xs font-bold tracking-wider text-gray-800 uppercase">
						Paragraph Selected
					</h3>
					<div class="rounded-lg bg-yellow-50 p-1 shadow-sm">
						<textarea
							bind:value={$selectedParagraph.text}
							class="h-32 w-full border-none bg-transparent text-sm text-gray-700"
						></textarea>
					</div>
				</div>

				<div>
					<h3 class="mb-4 text-xs font-bold tracking-widest text-gray-800 uppercase">
						Relations ({relatedParagraphs.length})
					</h3>
					<div class="mt-4 flex flex-col gap-3">
						{#each relatedParagraphs as p}
							<div
								class="rounded-lg border p-3 text-sm transition-all {p.relationType === 'reference'
									? 'border-blue-200 bg-blue-50'
									: 'border-green-200 bg-green-50'}"
							>
								<span
									class="text-[10px] font-bold tracking-wider uppercase {p.relationType ===
									'reference'
										? 'text-blue-600'
										: 'text-green-600'}"
								>
									{p.relationType}
								</span>
								<p class="mt-1 leading-relaxed whitespace-pre-wrap text-gray-600 italic">
									"{p.text}"
								</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</main>

<style>
	:global(body) {
		margin: 0;
		background-color: #f3f4f6;
	}
	canvas {
		max-width: 100%;
		height: auto !important;
	}
</style>
