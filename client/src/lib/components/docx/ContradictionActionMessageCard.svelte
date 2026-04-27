<script lang="ts">
	import type { AssistantChatMessage } from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import ContractChatAssistantIcon from '$lib/icons/ContractChatAssistantIcon.svelte';
	import UserIcon from '$lib/icons/UserIcon.svelte';

	export let message: AssistantChatMessage;
	export let rewriteBusy = false;
	export let compact = false;
	export let onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void = () => {};
	export let onAcceptFixSuggestion: (messageId: string) => void | Promise<void> = () => {};

	$: isUserMessage = message.role === 'user';
	$: bubbleClass = isUserMessage
		? 'border border-blue-200 bg-blue-50 text-blue-900'
		: 'border border-gray-200 bg-white text-gray-700';
</script>

<div class="inline-flex max-w-[92%] items-start gap-1.5">
	{#if isUserMessage}
		<div
			class={`rounded-lg leading-relaxed shadow-sm ${
				compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-2 text-[11px]'
			} ${bubbleClass}`}
		>
			{#if message.fixContradictionSuggestion}
				{@const fix = message.fixContradictionSuggestion}
				<div class="space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-1">
						<div class="flex flex-wrap items-center gap-1">
							<span class="text-[10px] font-bold text-gray-800">Structured contradiction fix</span>
							<button
								type="button"
								class="docx-reference-chip"
								onclick={() => onFocusNodeFromPanel(fix.paragraphId, true)}
							>
								{fix.paragraphId}
							</button>
						</div>
						{#if fix.status === 'applied'}
							<Badge
								variant="outline"
								class="h-4 border-green-200 bg-green-50 px-1.5 text-[8px] font-semibold text-green-700"
							>
								Applied
							</Badge>
						{/if}
					</div>
					{#if fix.reason}
						<p class="text-[10px] text-gray-700">{fix.reason}</p>
					{/if}
					<div class="rounded border border-gray-200 bg-gray-50/80 px-2 py-1.5">
						<p class="mb-1 text-[9px] font-bold text-gray-700">Changes needed</p>
						<ul class="space-y-1 text-[10px] text-gray-700">
							{#each fix.changeNotes as note, noteIndex (`${message.id}-fix-note-${noteIndex}`)}
								<li class="leading-relaxed">• {note}</li>
							{/each}
						</ul>
					</div>
					<div class="overflow-hidden rounded border border-gray-200 bg-white">
						<div class="border-b border-gray-100 bg-red-50/40 px-2 py-1">
							<p class="text-[9px] font-semibold text-red-700">Original Snippet</p>
							<p class="mt-0.5 text-[10px] leading-relaxed text-gray-900">
								{fix.rewriteResult.payload.originalSnippet}
							</p>
						</div>
						<div class="bg-green-50/40 px-2 py-1">
							<p class="text-[9px] font-semibold text-green-700">Proposed Rewrite</p>
							<p class="mt-0.5 text-[10px] leading-relaxed text-gray-900">
								{fix.rewriteResult.payload.simplifiedSnippet}
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						class="h-7 border-green-200 bg-green-50 px-2 text-[10px] font-semibold text-green-700 hover:border-green-300 hover:bg-green-100"
						disabled={rewriteBusy || fix.status === 'applied'}
						onclick={() => void onAcceptFixSuggestion(message.id)}
					>
						{fix.status === 'applied' ? 'Suggestion applied' : 'Accept suggestion'}
					</Button>
				</div>
			{:else if message.freeContradictionExplanation}
				{@const free = message.freeContradictionExplanation}
				<div class="space-y-1.5">
					<div class="flex flex-wrap items-center gap-1">
						<span class="font-bold text-gray-800">Free explanation for paragraph</span>
					</div>
					<p class="text-[10px] text-gray-700">{free.reason}</p>
					{#if free.snippetA && free.snippetB}
						<div class="space-y-1">
							<p class="text-[10px] font-bold text-red-700">Snippet A ({free.snippetA.source}):</p>
							<p class="rounded border border-red-300 bg-red-100/70 px-2 py-1 text-[10px] text-red-900">
								"{free.snippetA.text}"
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-[10px] font-bold text-yellow-700">Snippet B ({free.snippetB.source}):</p>
							<p
								class="rounded border border-yellow-300 bg-yellow-100/75 px-2 py-1 text-[10px] text-yellow-900"
							>
								"{free.snippetB.text}"
							</p>
						</div>
					{:else if free.fallbackEvidenceMessage}
						<p class="text-[10px] text-gray-600">{free.fallbackEvidenceMessage}</p>
					{/if}
					<p class="text-[10px] text-gray-600">{free.footerMessage}</p>
				</div>
			{/if}
		</div>
		<span class="mt-1 inline-flex shrink-0 items-center justify-center text-blue-600">
			<UserIcon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={1.9} />
			<span class="sr-only">You</span>
		</span>
	{:else}
		<span class="mt-1 inline-flex shrink-0 items-center justify-center text-gray-500">
			<ContractChatAssistantIcon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={1.9} />
			<span class="sr-only">Assistant</span>
		</span>
		<div
			class={`rounded-lg leading-relaxed shadow-sm ${
				compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-2 text-[11px]'
			} ${bubbleClass}`}
		>
			{#if message.fixContradictionSuggestion}
				{@const fix = message.fixContradictionSuggestion}
				<div class="space-y-2">
					<div class="flex flex-wrap items-center justify-between gap-1">
						<div class="flex flex-wrap items-center gap-1">
							<span class="text-[10px] font-bold text-gray-800">Structured contradiction fix</span>
							<button
								type="button"
								class="docx-reference-chip"
								onclick={() => onFocusNodeFromPanel(fix.paragraphId, true)}
							>
								{fix.paragraphId}
							</button>
						</div>
						{#if fix.status === 'applied'}
							<Badge
								variant="outline"
								class="h-4 border-green-200 bg-green-50 px-1.5 text-[8px] font-semibold text-green-700"
							>
								Applied
							</Badge>
						{/if}
					</div>
					{#if fix.reason}
						<p class="text-[10px] text-gray-700">{fix.reason}</p>
					{/if}
					<div class="rounded border border-gray-200 bg-gray-50/80 px-2 py-1.5">
						<p class="mb-1 text-[9px] font-bold text-gray-700">Changes needed</p>
						<ul class="space-y-1 text-[10px] text-gray-700">
							{#each fix.changeNotes as note, noteIndex (`${message.id}-fix-note-${noteIndex}`)}
								<li class="leading-relaxed">• {note}</li>
							{/each}
						</ul>
					</div>
					<div class="overflow-hidden rounded border border-gray-200 bg-white">
						<div class="border-b border-gray-100 bg-red-50/40 px-2 py-1">
							<p class="text-[9px] font-semibold text-red-700">Original Snippet</p>
							<p class="mt-0.5 text-[10px] leading-relaxed text-gray-900">
								{fix.rewriteResult.payload.originalSnippet}
							</p>
						</div>
						<div class="bg-green-50/40 px-2 py-1">
							<p class="text-[9px] font-semibold text-green-700">Proposed Rewrite</p>
							<p class="mt-0.5 text-[10px] leading-relaxed text-gray-900">
								{fix.rewriteResult.payload.simplifiedSnippet}
							</p>
						</div>
					</div>
					<Button
						variant="outline"
						size="sm"
						class="h-7 border-green-200 bg-green-50 px-2 text-[10px] font-semibold text-green-700 hover:border-green-300 hover:bg-green-100"
						disabled={rewriteBusy || fix.status === 'applied'}
						onclick={() => void onAcceptFixSuggestion(message.id)}
					>
						{fix.status === 'applied' ? 'Suggestion applied' : 'Accept suggestion'}
					</Button>
				</div>
			{:else if message.freeContradictionExplanation}
				{@const free = message.freeContradictionExplanation}
				<div class="space-y-1.5">
					<div class="flex flex-wrap items-center gap-1">
						<span class="font-bold text-gray-800">Free explanation for paragraph</span>
					</div>
					<p class="text-[10px] text-gray-700">{free.reason}</p>
					{#if free.snippetA && free.snippetB}
						<div class="space-y-1">
							<p class="text-[10px] font-bold text-red-700">Snippet A ({free.snippetA.source}):</p>
							<p class="rounded border border-red-300 bg-red-100/70 px-2 py-1 text-[10px] text-red-900">
								"{free.snippetA.text}"
							</p>
						</div>
						<div class="space-y-1">
							<p class="text-[10px] font-bold text-yellow-700">Snippet B ({free.snippetB.source}):</p>
							<p
								class="rounded border border-yellow-300 bg-yellow-100/75 px-2 py-1 text-[10px] text-yellow-900"
							>
								"{free.snippetB.text}"
							</p>
						</div>
					{:else if free.fallbackEvidenceMessage}
						<p class="text-[10px] text-gray-600">{free.fallbackEvidenceMessage}</p>
					{/if}
					<p class="text-[10px] text-gray-600">{free.footerMessage}</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
