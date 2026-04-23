<script lang="ts">
	import type { SimplifyResultState } from '$lib/types/document';
	import { buildChangeLog } from '$lib/utils/docx/change-log';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	export let simplifyResult: SimplifyResultState | null = null;
	export let rewriteSource: 'simplify' | 'fix' | null = null;
	export let simplifyError: string | null = null;
	export let rewriteBusy = false;
	export let selectedParagraphId: string | null = null;
	export let onReplace: () => void = () => {};
	export let onCopy: () => void | Promise<void> = () => {};
	export let onReject: () => void = () => {};
	export let onFocusParagraph: ((paragraphId: string) => void) | null = null;
	export let applyLabel = 'Replace';
	export let rejectLabel = 'Reject';
	export let minimal = false;
	export let showCopyAction = true;

	$: resultParagraphId = simplifyResult?.payload.evidence.paragraph_id ?? null;
	$: resultIsOnAnotherParagraph = Boolean(
		resultParagraphId && selectedParagraphId && resultParagraphId !== selectedParagraphId
	);
	$: sourceLabel =
		rewriteSource === 'fix'
			? 'Fix Contradiction'
			: rewriteSource === 'simplify'
				? 'Simplify'
				: 'AI Rewrite';
	$: snippetChangeLog = simplifyResult
		? buildChangeLog(simplifyResult.payload.originalSnippet, simplifyResult.payload.simplifiedSnippet)
		: null;
</script>

{#if simplifyError}
	<Card.Root size="sm" class="border-red-200 bg-red-50 py-0 text-[11px]">
		<Card.Content class="px-3 py-2 text-red-700">{simplifyError}</Card.Content>
	</Card.Root>
{/if}

{#if simplifyResult}
	<Card.Root
		size="sm"
		class={`py-0 text-[11px] ${minimal ? 'border-gray-200 bg-white' : 'border-blue-200 bg-blue-50/50'}`}
	>
		{#if !minimal}
			<Card.Header class="space-y-1 px-3 py-2">
				<div class="flex items-center justify-between gap-2">
					<div></div>
					<Badge
						variant="outline"
						class="h-5 border-blue-200 bg-white px-2 text-[9px] font-bold text-blue-700"
					>
						{sourceLabel}
					</Badge>
				</div>
				<Card.Description class="text-[10px] text-blue-700/80">
					Paragraph {simplifyResult.payload.paragraphId}
				</Card.Description>
			</Card.Header>
		{/if}
		<Card.Content class={`space-y-2 px-3 pb-3 ${minimal ? 'pt-5' : ''}`}>
			{#if !minimal && resultIsOnAnotherParagraph && resultParagraphId}
				<div class="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
					Result belongs to paragraph {resultParagraphId}.
					{#if onFocusParagraph}
						<Button
							variant="link"
							size="xs"
							class="h-auto px-1 text-[10px] text-amber-800 underline hover:text-amber-900"
							onclick={() => onFocusParagraph && onFocusParagraph(resultParagraphId)}
						>
							Go to paragraph
						</Button>
					{/if}
				</div>
			{/if}

			<div class="overflow-hidden rounded border border-gray-200 bg-white">
				<div class="border-b border-gray-100 bg-red-50/40 px-2.5 py-1.5">
					<p class="text-[9px] font-semibold text-red-700">{minimal ? 'Original' : 'Original Snippet'}</p>
					<p class="mt-0.5 font-mono leading-relaxed text-red-800/90">
						{#if snippetChangeLog}
							{#each snippetChangeLog.oldSegments as segment}
								{#if segment.changed}
									<mark class="rounded-sm bg-red-100 px-[2px] text-red-900">{segment.value}</mark>
								{:else}
									<span>{segment.value}</span>
								{/if}
							{/each}
						{:else}
							{simplifyResult.payload.originalSnippet}
						{/if}
					</p>
				</div>
				<div class="bg-green-50/40 px-2.5 py-1.5">
					<p class="text-[9px] font-semibold text-green-700">{minimal ? 'Suggested' : 'Proposed Rewrite'}</p>
					<p class="mt-0.5 font-mono leading-relaxed text-green-800">
						{#if snippetChangeLog}
							{#each snippetChangeLog.newSegments as segment}
								{#if segment.changed}
									<mark class="rounded-sm bg-green-100 px-[2px] text-green-900">{segment.value}</mark>
								{:else}
									<span>{segment.value}</span>
								{/if}
							{/each}
						{:else}
							{simplifyResult.payload.simplifiedSnippet}
						{/if}
					</p>
				</div>
			</div>

			<div class={`grid gap-1.5 ${showCopyAction && !minimal ? 'grid-cols-3' : 'grid-cols-2'}`}>
				<Button
					variant="outline"
					size="sm"
					class="h-7 border-green-200 bg-green-50 text-[10px] font-semibold text-green-700 hover:border-green-300 hover:bg-green-100"
					disabled={rewriteBusy}
					onclick={onReplace}
				>
					{applyLabel}
				</Button>
				{#if showCopyAction && !minimal}
					<Button
						variant="outline"
						size="sm"
						class="h-7 border-sky-200 bg-sky-50 text-[10px] font-semibold text-sky-700 hover:border-sky-300 hover:bg-sky-100"
						disabled={rewriteBusy}
						onclick={() => void onCopy()}
					>
						Copy
					</Button>
				{/if}
				<Button
					variant="outline"
					size="sm"
					class="h-7 border-red-200 bg-red-50 text-[10px] font-semibold text-red-700 hover:border-red-300 hover:bg-red-100"
					disabled={rewriteBusy}
					onclick={onReject}
				>
					{rejectLabel}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>
{/if}
