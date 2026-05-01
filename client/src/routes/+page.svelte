<script lang="ts">
	import { onMount } from 'svelte';

	import { api } from '$lib/api/client';
	import { Input } from '$lib/components/ui/input';
	import DocumentIcon from '$lib/icons/DocumentIcon.svelte';
	import type { DocumentMeta } from '$lib/types/document';

	let documents = $state<DocumentMeta[]>([]);
	let searchTerm = $state('');
	let loading = $state(true);
	let error = $state('');

	const filteredDocuments = $derived.by(() => {
		const query = searchTerm.trim().toLowerCase();
		if (!query) return documents;

		return documents.filter((doc) =>
			[doc.name, doc.group_label, doc.relative_path, doc.display_name].some((value) =>
				(value ?? '').toLowerCase().includes(query)
			)
		);
	});

	onMount(async () => {
		try {
			const response = await api.get<DocumentMeta[]>('/list_documents');
			documents = response.data;
		} catch (err) {
			console.error(err);
			error = 'Could not load CUAD documents from backend.';
		} finally {
			loading = false;
		}
	});
</script>

<main class="min-h-screen w-full flex justify-center items-center">
	<div class="max-w-5xl w-full">
		<div>
			<h1 class="mb-8 text-center text-4xl">Contradiction Explorer</h1>
		</div>

		<section class="bg-card p-6">
			<header class="mb-4">
				<h2 class="text-2xl font-medium">Dataset (CUAD)</h2>
			</header>

			<div class="mb-6">
				<Input bind:value={searchTerm} class="rounded-full h-14 pl-8" placeholder="Search document..." />
			</div>

			<div class="flex items-center justify-center">
				{#if loading}
					<p class="text-muted-foreground">Loading documents...</p>
				{:else if error}
					<p class="text-destructive">{error}</p>
				{:else if filteredDocuments.length === 0}
					<p class="text-muted-foreground">No documents found.</p>
				{:else}
					<ul class="space-y-5">
						{#each filteredDocuments as doc (doc.id)}
							<li>
								<a
									href={`/docx?id=${encodeURIComponent(doc.id)}`}
									class="flex items-start gap-3 rounded-md transition-colors hover:bg-muted"
								>
									<DocumentIcon />
									<div class="min-w-0 text-sm">
										<p class="truncate">{doc.name}</p>
										<p class="text-muted-foreground">{doc.group_label}</p>
									</div>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</section>
	</div>
</main>
