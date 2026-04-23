<script lang="ts">
	import type {
		Node as ParagraphNode,
		SimplifyResultState
	} from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import ParagraphRewriteResult from './ParagraphRewriteResult.svelte';

	export let selectedParagraph: ParagraphNode | null = null;
	export let loading = false;
	export let error: string | null = null;
	export let explanation = '';
	export let simplifyResult: SimplifyResultState | null = null;
	export let simplifyError: string | null = null;
	export let rewriteSource: 'simplify' | 'fix' | null = null;
	export let rewriteBusy = false;
	export let onReplaceRewrite: () => void = () => {};
	export let onCopyRewrite: () => void | Promise<void> = () => {};
	export let onRejectRewrite: () => void = () => {};
	export let onFocusParagraph: (paragraphId: string) => void = () => {};
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">Detailed explanation for the selected paragraph.</p>
	</header>

	<div class="border-b border-gray-100 bg-white px-3 py-2.5">
		{#if selectedParagraph}
			<p class="text-[10px] text-gray-500">
				Selected: {selectedParagraph.id} &middot; Page {selectedParagraph.page}
			</p>
		{/if}
	</div>

	<ScrollArea class="min-h-0 flex-1 bg-gray-50/30">
		<div class="space-y-2 p-3">
			{#if !selectedParagraph}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] font-medium">Select a paragraph on the left.</p>
				</div>
			{:else}
				{#if loading}
					<div class="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
						Generating paragraph explanation...
					</div>
				{/if}
				{#if error}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div>
				{/if}
				{#if simplifyResult || simplifyError}
					<div class="relative">
						<div class="pointer-events-none absolute top-1.5 left-2 z-10">
							<Badge
								variant="outline"
								class="h-4 border-blue-100 bg-blue-50 px-2 text-[9px] font-semibold text-blue-600"
							>
								Simplify 
							</Badge>
						</div>
						<ParagraphRewriteResult
							simplifyResult={simplifyResult}
							rewriteSource={rewriteSource}
							simplifyError={simplifyError}
							rewriteBusy={rewriteBusy}
							selectedParagraphId={selectedParagraph?.id ?? null}
							applyLabel="Accept"
							rejectLabel="Reject"
							minimal={true}
							showCopyAction={false}
							onReplace={onReplaceRewrite}
							onCopy={onCopyRewrite}
							onReject={onRejectRewrite}
							onFocusParagraph={onFocusParagraph}
						/>
					</div>
				{/if}
				{#if explanation}
					<div class="rounded border border-gray-200 bg-white px-3 py-2">
						<div class="mb-1">
							<Badge
								variant="outline"
								class="h-4 border-blue-100 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-600"
							>
								Explain
							</Badge>
						</div>
						<p class="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700">{explanation}</p>
					</div>
				{/if}
			{/if}
		</div>
	</ScrollArea>
</section>
