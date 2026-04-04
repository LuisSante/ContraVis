<script lang="ts">
	import './layout.css';
	import favicon from '$lib/icons/icons8-justiça-100.png';
	import { loading } from '$lib/stores/document';
	import { fade } from 'svelte/transition';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if $loading}
	<div
		transition:fade
		class="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-lg"
	>
		<div
			class="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-transparent"
		></div>
		Loading...
	</div>
{/if}

{@render children()}
