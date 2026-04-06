<script lang="ts">
	import HammerShieldIcon from '$lib/icons/HammerShieldIcon.svelte';
	import SimplifyWandIcon from '$lib/icons/SimplifyWandIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';

	export let visible = false;
	export let top = 0;
	export let left = 0;
	export let simplifyLoading = false;
	export let fixContradictionLoading = false;
	export let assistantLoading = false;
	export let onFixContradiction: () => void | Promise<void> = () => {};
	export let onSimplify: () => void | Promise<void> = () => {};
	export let onClose: () => void = () => {};
</script>

{#if visible}
	<Card.Root
		class="fixed z-40 w-52 gap-0 border-slate-200 bg-white/95 p-0 shadow-[0_12px_32px_rgba(15,23,42,0.15)] backdrop-blur-sm"
		style={`top: ${top}px; left: ${left}px;`}
	>
		<Card.Header class="px-2.5 py-1.5">
			<Card.Title class="text-[11px] font-semibold text-slate-700">Paragraph Tools</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-1 px-2.5">
			<Button
				variant="outline"
				size="sm"
				class="h-7 w-full justify-between border-amber-200 bg-amber-50 px-2 text-[10px] font-bold text-amber-800 hover:border-amber-300 hover:bg-amber-100"
				disabled={fixContradictionLoading || assistantLoading || simplifyLoading}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => void onFixContradiction()}
			>
				<span class="inline-flex items-center gap-1.5">
					<HammerShieldIcon className="h-3.5 w-3.5" />
					<span>{fixContradictionLoading ? 'Fixing...' : 'Fix Contradiction'}</span>
				</span>
			</Button>

			<Button
				variant="outline"
				size="sm"
				class="h-7 w-full justify-between border-sky-200 bg-sky-50 px-2 text-[10px] font-bold text-sky-800 hover:border-sky-300 hover:bg-sky-100"
				disabled={simplifyLoading || fixContradictionLoading}
				onmousedown={(event) => event.preventDefault()}
				onclick={() => void onSimplify()}
			>
				<span class="inline-flex items-center gap-1.5">
					<SimplifyWandIcon className="h-3.5 w-3.5" />
					<span>{simplifyLoading ? 'Simplifying...' : 'Simplify'}</span>
				</span>
			</Button>
		</Card.Content>
		<Card.Footer class="px-2.5 pb-1.5 pt-1">
			<Button
				class="h-6 w-full border-gray-200 bg-white px-2 text-[9px] font-semibold text-gray-500 hover:border-gray-300 hover:bg-gray-50"
				variant="outline"
				size="sm"
				onmousedown={(event) => event.preventDefault()}
				onclick={onClose}
			>
				Close Tools
			</Button>
		</Card.Footer>
	</Card.Root>
{/if}
