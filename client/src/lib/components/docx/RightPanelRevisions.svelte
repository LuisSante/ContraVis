<script lang="ts">
	import type { ChangeLogState, Node as ParagraphNode, SimplifyResultState } from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import ParagraphRewriteResult from './ParagraphRewriteResult.svelte';

	export let selectedParagraph: ParagraphNode | null = null;
	export let selectedChangeLog: ChangeLogState = {
		hasChanges: false,
		oldSegments: [],
		newSegments: []
	};
	export let simplifyResult: SimplifyResultState | null = null;
	export let simplifyError: string | null = null;
	export let rewriteSource: 'simplify' | 'fix' | null = null;
	export let rewriteBusy = false;
	export let onReplaceRewrite: () => void = () => {};
	export let onCopyRewrite: () => void | Promise<void> = () => {};
	export let onRejectRewrite: () => void = () => {};
	export let onFocusParagraph: (paragraphId: string) => void = () => {};
	export let commitShortcutHint = '';
	export let commitShortcutLabel = '';
	export let commitShortcutTooltip = '';
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			View modification history and compare original versus edited content.
		</p>
		<div class="group relative inline-flex">
			<Badge
				variant="outline"
				class="h-5 cursor-help border-gray-200 bg-white px-2 text-[9px] font-bold tracking-tight text-gray-600"
				title={commitShortcutHint}
			>
				{commitShortcutLabel}
			</Badge>
			<div
				class="pointer-events-none absolute top-full right-0 z-20 mt-1 rounded bg-gray-800 px-2 py-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-white opacity-0 shadow-2xl ring-1 ring-white/20 transition-opacity group-hover:opacity-100 {selectedChangeLog.hasChanges
					? 'animate-bounce'
					: ''}"
			>
				{commitShortcutTooltip}
			</div>
		</div>
	</header>

	<ScrollArea class="min-h-0 flex-1">
		<div class="space-y-2 p-3">
			<ParagraphRewriteResult
				simplifyResult={simplifyResult}
				rewriteSource={rewriteSource}
				simplifyError={simplifyError}
				rewriteBusy={rewriteBusy}
				selectedParagraphId={selectedParagraph?.id ?? null}
				onReplace={onReplaceRewrite}
				onCopy={onCopyRewrite}
				onReject={onRejectRewrite}
				onFocusParagraph={onFocusParagraph}
			/>

			{#if !selectedParagraph}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] font-medium">Select a paragraph to view revision history</p>
					<p class="mt-1 text-[10px] text-gray-400">
						Choose a paragraph in the document on the left.
					</p>
				</div>
			{:else if !selectedChangeLog.hasChanges && !simplifyResult}
				<div class="flex flex-col items-center justify-center py-2 text-gray-300">
					<p class="text-[10px] italic">No modifications recorded for this paragraph.</p>
				</div>
			{:else if selectedChangeLog.hasChanges}
				<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
					<div class="border-b border-gray-50 bg-red-50/20 px-3 py-2">
						<span class="mb-1 block text-[8px] font-semibold text-red-300">Original</span>
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
						<span class="mb-1 block text-[8px] font-semibold text-green-300">Modified</span>
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
	</ScrollArea>
</section>
