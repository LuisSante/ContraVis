<script lang="ts">
	import DatasetList from '$lib/components/DatasetList.svelte';
	import type { DocumentMeta } from '$lib/types/document';

	let { data } = $props();
	const documents: DocumentMeta[] = $derived(data.documents);

</script>

<main class="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
	<div class="w-full max-w-7xl space-y-10">

		<header class="text-center space-y-2">
			<h1 class="text-2xl">Contradiction Explorer</h1>
		</header>

		<section>
			<div class="bg-white border rounded-lg p-6 shadow-sm">
				<h2 class="font-medium mb-4">Dataset (CUAD)</h2>
				<DatasetList {documents} />
			</div>
		</section>

	</div>
</main>
