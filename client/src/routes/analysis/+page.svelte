<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { paragraphs } from '$lib/stores/document';
	import type { Paragraph } from '$lib/types/document';

	let container: HTMLDivElement;
	let selectedId: string | null = null;

	let paras: Paragraph[] = [];
	let byPage = new Map<number, Paragraph[]>();
	let pageList: number[] = [];

	function groupByPage() {
		byPage = new Map();
		for (const p of paras) {
			const arr = byPage.get(p.page) ?? [];
			arr.push(p);
			byPage.set(p.page, arr);
		}
		pageList = Array.from(byPage.keys()).sort((a, b) => a - b);
	}

	function onClickPara(id: string) {
		selectedId = id;
	}

	onMount(() => {
		paras = get(paragraphs) as Paragraph[];
		groupByPage();
	});
</script>

<div class="grid grid-cols-2 gap-4 p-4">
	<div
		bind:this={container}
		class="h-[95vh] rounded-xl border border-gray-200 bg-gray-50 p-6"
	>
		<div class="flex flex-col gap-6">
			{#each pageList as pg}
				<section class="relative rounded-md border border-gray-200 bg-white shadow-sm">
					<!-- “hoja” -->
					<div class="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
						Page {pg + 1}
					</div>

					<!-- contenido -->
					<div class="relative px-10 py-8 font-serif text-sm leading-relaxed">
						{#each byPage.get(pg) ?? [] as p (p.id)}
							<p
								data-pid={p.id}
								class={'mb-2 border-2 cursor-pointer rounded px-1 py-0.5 hover:bg-gray-50 ' +
									(selectedId === p.id ? 'bg-red-50' : '')}
								on:click={() => onClickPara(p.id)}
							>
								{p.text}
							</p>
						{/each}
					</div>
				</section>
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
