<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { paragraphs } from '$lib/stores/document';
	import type { Paragraph } from '$lib/types/document';

	let container: HTMLDivElement;
	let svg: SVGSVGElement;
	let paras: Paragraph[] = [];

	type DomBox = { id: string; x: number; y: number; w: number; h: number };

	let boxes: DomBox[] = [];
	let selectedId: string | null = null;

	function renderBBoxes() {
		if (!container || !svg) return;

		const containerRect = container.getBoundingClientRect();
		const nodes = Array.from(container.querySelectorAll<HTMLElement>('[data-pid]'));

		boxes = nodes.map((el) => {
			const r = el.getBoundingClientRect();
			return {
				id: el.dataset.pid!,
				x: r.left - containerRect.left + container.scrollLeft,
				y: r.top - containerRect.top + container.scrollTop,
				w: r.width,
				h: r.height
			};
		});

		svg.setAttribute('width', String(container.scrollWidth));
		svg.setAttribute('height', String(container.scrollHeight));
	}

	function onClickPara(id: string) {
		selectedId = id;
	}

	onMount(() => {
		paras = get(paragraphs) as Paragraph[];

		requestAnimationFrame(() => renderBBoxes());

		const ro = new ResizeObserver(() => renderBBoxes());
		ro.observe(container);

		const onScroll = () => renderBBoxes();
		container.addEventListener('scroll', onScroll);

		return () => {
			ro.disconnect();
			container.removeEventListener('scroll', onScroll);
		};
	});
</script>

<div class="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[1fr_320px]">
	<div
		bind:this={container}
		class="relative h-[95vh] overflow-auto rounded-xl border border-gray-200 bg-white"
	>
		<svg bind:this={svg} class="pointer-events-none absolute top-0 left-0">
			{#each boxes as b (b.id)}
				<rect
					x={b.x}
					y={b.y}
					width={b.w}
					height={b.h}
					fill="transparent"
					stroke={selectedId === b.id ? 'rgb(239 68 68)' : 'rgba(0,0,0,0.18)'}
					stroke-width="2"
					class="pointer-events-auto cursor-pointer"
					on:click={() => onClickPara(b.id)}
				/>
			{/each}
		</svg>

		<div class="relative p-6">
			{#each paras as p (p.id)}
				<p
					data-pid={p.id}
					class="mb-2 cursor-pointer leading-relaxed hover:bg-gray-50"
					on:click={() => onClickPara(p.id)}
				>
					{#each p.runs as run}
						<span
							style="
								font-weight: {run.bold ? '700' : '400'};
								font-style: {run.italic ? 'italic' : 'normal'};
							"
						>
							{run.text}
						</span>
					{/each}
				</p>
			{/each}
		</div>
	</div>

	<aside class="rounded-xl border border-gray-200 bg-white p-3">
		<div class="text-sm">
			<span class="font-semibold">Selected:</span>
			<span class="ml-1 font-mono">{selectedId ?? 'none'}</span>
		</div>
	</aside>
</div>
