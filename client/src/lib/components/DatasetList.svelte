<script lang="ts">
	import type { DocumentMeta } from '$lib/types/document';
	import { goto } from '$app/navigation';
	import { currentDocument, loading, error } from '$lib/stores/document';

	export let documents: DocumentMeta[];
	let query = '';

	$: filteredDocuments = documents.filter((doc) =>
		doc.name.toLowerCase().includes(query.toLowerCase())
	);

	async function selectDocument(doc: DocumentMeta) {
		currentDocument.set(doc);
		loading.set(true);
		error.set(null);

		try {
			await goto(`/docx?id=${encodeURIComponent(doc.id)}`);
		} catch (err) {
			error.set('Error processing document');
		} finally {
			loading.set(false);
		}
	}
</script>

<input
	type="text"
	placeholder="Search document..."
	class="mb-3 w-full rounded-md border px-3 py-2 text-sm focus:ring focus:outline-none"
	bind:value={query}
/>

<ul class="max-h-80 space-y-2 overflow-y-auto pr-1">
	{#if filteredDocuments.length === 0}
		<li class="text-sm text-gray-500 italic">No documents found</li>
	{:else}
		{#each filteredDocuments as doc}
			<li>
				<button
					class="w-full cursor-pointer rounded px-3 py-2 text-left transition hover:bg-gray-100"
					on:click={() => selectDocument(doc)}
				>
					📄 {doc.name}
				</button>
			</li>
		{/each}
	{/if}
</ul>
