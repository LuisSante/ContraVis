<script lang="ts">
	import { onMount } from 'svelte';
	import { pdfUrl } from '$lib/stores/document';
	import * as pdfjsLib from 'pdfjs-dist';
	import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
	import { api } from '$lib/api/client';
	import { get } from 'svelte/store';
	import { currentDocument } from '$lib/stores/document';

	pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

	let pagesData: any[] = [];
	let graphData: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };

	let loading = true;
	let elementStates: Record<
		string,
		{ original: string; committed: string; current: string; isDirty: boolean }
	> = {};
	let activeEditId: string | null = null;

	async function extractPdfData() {
		const url = $pdfUrl;
		if (!url) return;
		try {
			loading = true;
			const loadingTask = pdfjsLib.getDocument(url);
			const pdf = await loadingTask.promise;
			let extractedPages = [];

			for (let i = 1; i <= pdf.numPages; i++) {
				const page = await pdf.getPage(i);
				const textContent = await page.getTextContent();
				const viewport = page.getViewport({ scale: 1.5 });

				const items = textContent.items.map((item: any, idx: number) => {
					const [scaleX, b, c, scaleY, x, y] = item.transform;
					return {
						id: `p${i}-e${idx}`,
						text: item.str,
						x: x * viewport.scale,
						y: viewport.height - y * viewport.scale,
						fontSize: Math.sqrt(scaleX * scaleX + b * b) * viewport.scale
					};
				});
				extractedPages.push({
					pageNumber: i,
					width: viewport.width,
					height: viewport.height,
					elements: items
				});
			}

			pagesData = extractedPages;

			const doc = get(currentDocument);

			if (doc && doc.id) {
				const payload = {
					documentId: doc.id,
					pages: extractedPages
				};

				const response = await api.post('/process', payload);
				if (response.data.graph) {
					graphData = response.data.graph;
				}
				console.log('Backend processing complete:', response);
			} else {
				console.warn('No document ID found in store.');
			}
		} catch (err) {
			console.error('Error in extraction or processing:', err);
		} finally {
			loading = false;
		}
	}

	// Lógica reactiva para filtrar los párrafos relacionados basándose en activeEditId
	$: relatedParagraphs = (() => {
		if (!activeEditId || !graphData.edges.length) return [];

		// Buscamos conexiones donde el actual sea origen o destino
		const connections = graphData.edges.filter(
			(edge) => edge.source === activeEditId || edge.target === activeEditId
		);

		const relatedIds = connections.map((edge) =>
			edge.source === activeEditId ? edge.target : edge.source
		);

		return graphData.nodes
			.filter((node) => relatedIds.includes(node.id))
			.map((node) => {
				const edge = connections.find((e) => e.source === node.id || e.target === node.id);
				return {
					...node,
					relType: edge?.type,
					score: edge?.score
				};
			});
	})();

	function handleInput(id: string, event: Event) {
		const target = event.target as HTMLSpanElement;
		const currentText = target.innerText;
		if (!elementStates[id]) {
			const original = pagesData.flatMap((p) => p.elements).find((e) => e.id === id)?.text ?? '';
			elementStates[id] = { original, committed: original, current: currentText, isDirty: true };
		} else {
			elementStates[id] = { ...elementStates[id], current: currentText, isDirty: true };
		}
		elementStates = elementStates;
	}

	function handleFocus(id: string) {
		activeEditId = id;
	}
	function handleBlur() {}

	function handleKeydown(id: string, event: KeyboardEvent) {
		if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
			event.preventDefault();
			commitChange(id, event.target as HTMLSpanElement);
		}
	}

	function commitChange(id: string, target: HTMLSpanElement) {
		const currentText = target.innerText;
		if (!elementStates[id]) {
			const original = pagesData.flatMap((p) => p.elements).find((e) => e.id === id)?.text ?? '';
			elementStates[id] = { original, committed: original, current: currentText, isDirty: false };
		} else {
			elementStates[id] = {
				...elementStates[id],
				committed: currentText,
				current: currentText,
				isDirty: false
			};
		}
		elementStates = elementStates;
	}

	function computeDiff(
		oldText: string,
		newText: string
	): { token: string; type: 'equal' | 'removed' | 'added' }[] {
		const oldWords = oldText.split(/(\s+)/);
		const newWords = newText.split(/(\s+)/);
		const m = oldWords.length,
			n = newWords.length;
		const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

		for (let i = 1; i <= m; i++) {
			for (let j = 1; j <= n; j++) {
				if (oldWords[i - 1] === newWords[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
				else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
			}
		}

		const result: { token: string; type: 'equal' | 'removed' | 'added' }[] = [];
		let i = m,
			j = n;
		while (i > 0 || j > 0) {
			if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
				result.unshift({ token: oldWords[i - 1], type: 'equal' });
				i--;
				j--;
			} else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
				result.unshift({ token: newWords[j - 1], type: 'added' });
				j--;
			} else {
				result.unshift({ token: oldWords[i - 1], type: 'removed' });
				i--;
			}
		}
		return result;
	}

	$: committedChanges = Object.entries(elementStates)
		.filter(([id, state]) => id === activeEditId && state.committed !== state.original)
		.map(([id, state]) => ({ id, ...state }));

	onMount(extractPdfData);
</script>

<div class="flex h-screen w-screen overflow-hidden bg-gray-100 font-sans">
	<div
		class="flex w-[60%] flex-col items-center overflow-auto border-r border-gray-300 px-4 py-6 shadow-inner"
	>
		{#each pagesData as page}
			<div
				class="relative mb-6 shrink-0 bg-white shadow-xl"
				style="width: {page.width}px; min-height: {page.height}px;"
			>
				{#each page.elements as el (el.id)}
					{@const state = elementStates[el.id]}
					{@const isEdited = state && state.committed !== state.original}
					{@const isDirty = state && state.isDirty}

					<span
						contenteditable="true"
						class="absolute origin-top-left leading-none whitespace-pre-wrap transition-all outline-none
                               hover:ring-1 hover:ring-blue-300 focus:ring-2 focus:ring-yellow-400
                               {isEdited ? 'ring-1 ring-green-400' : ''}
                               {isDirty ? 'ring-1 ring-orange-400' : ''}
                               {activeEditId === el.id
							? 'z-10 bg-yellow-50/50 ring-2 ring-yellow-400'
							: ''}"
						style="left: {el.x}px; top: {el.y}px; font-size: {el.fontSize}px; min-width: 4px;"
						on:input={(e) => handleInput(el.id, e)}
						on:focus={() => handleFocus(el.id)}
						on:blur={handleBlur}
						on:keydown={(e) => handleKeydown(el.id, e)}
					>
						{el.text}
					</span>

					{#if activeEditId === el.id && state?.isDirty}
						<div
							class="pointer-events-none absolute z-20 animate-bounce rounded bg-gray-800 px-2 py-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-white shadow-2xl ring-1 ring-white/20"
							style="left: {el.x}px; top: {el.y - 28}px;"
						>
							Ctrl + Shift + Enter to save
						</div>
					{/if}
				{/each}
			</div>
		{/each}
	</div>

	<div class="flex w-[40%] flex-col overflow-hidden bg-white shadow-xl">
		<div class="flex flex-none flex-col border-b border-gray-200">
			<header
				class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2"
			>
				<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">Change Log</h3>
				{#if activeEditId}
					<span
						class="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 font-mono text-[9px] text-blue-500"
					>
						{activeEditId}
					</span>
				{/if}
			</header>

			<div class="max-h-[35vh] overflow-y-auto p-3">
				{#each committedChanges as change (change.id)}
					{@const diff = computeDiff(change.original, change.committed)}
					<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
						<div class="border-b border-gray-50 bg-red-50/20 px-3 py-2">
							<span class="mb-1 block text-[8px] font-bold text-red-300 uppercase">Original</span>
							<p class="font-mono leading-relaxed text-red-700/80">
								{#each diff as token}
									{#if token.type === 'removed'}<mark class="bg-red-100 px-0.5 text-red-800"
											>{token.token}</mark
										>
									{:else if token.type === 'equal'}<span>{token.token}</span>{/if}
								{/each}
							</p>
						</div>
						<div class="bg-green-50/20 px-3 py-2">
							<span class="mb-1 block text-[8px] font-bold text-green-300 uppercase">Modified</span>
							<p class="font-mono leading-relaxed text-green-800">
								{#each diff as token}
									{#if token.type === 'added'}<mark class="bg-green-100 px-0.5 text-green-800"
											>{token.token}</mark
										>
									{:else if token.type === 'equal'}<span>{token.token}</span>{/if}
								{/each}
							</p>
						</div>
					</div>
				{:else}
					<div class="py-2 flex flex-col items-center justify-center text-gray-300">
						<p class="text-[10px] italic">No active changes</p>
					</div>
				{/each}
			</div>
		</div>

		<div class="flex flex-1 flex-col">
			<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
				<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
					Related Paragraphs
				</h3>
			</header>

			<div class="flex flex-1 flex-col space-y-2 overflow-y-auto bg-gray-50/30 p-2">
				{#if activeEditId}
					{#each relatedParagraphs as rel}
						<div
							class="group rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
						>
							<div class="mb-2 flex items-center justify-between">
								<span
									class="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 uppercase"
								>
									{rel.relType === 'semantic_similarity' ? 'Similarity' : 'Reference'}
								</span>
								<span class="text-[9px] font-bold tracking-tighter text-gray-400 uppercase"
									>Page {rel.page}</span
								>
							</div>

							<p class="text-[11px] leading-relaxed text-gray-600">
								{rel.text}
							</p>

							{#if rel.score}
								<div class="mt-2 flex items-center gap-2">
									<div class="h-1 flex-1 overflow-hidden rounded-full bg-gray-100">
										<div
											class="h-full bg-blue-400 transition-all"
											style="width: {rel.score * 100}%"
										></div>
									</div>
									<span class="text-[8px] font-bold text-blue-400"
										>{(rel.score * 100).toFixed(0)}%</span
									>
								</div>
							{/if}
						</div>
					{:else}
						<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
							<p class="text-[10px] italic">No relations found for this element</p>
						</div>
					{/each}
				{:else}
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
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	[contenteditable='true']::selection {
		background: rgba(250, 204, 21, 0.3);
	}
	.overflow-y-auto::-webkit-scrollbar {
		width: 3px;
	}
	.overflow-y-auto::-webkit-scrollbar-track {
		background: transparent;
	}
	.overflow-y-auto::-webkit-scrollbar-thumb {
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
