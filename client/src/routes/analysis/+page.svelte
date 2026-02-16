<script lang="ts">
	import { paragraphs, selectedParagraph, currentDocument } from '$lib/stores/document';
	import ParagraphEditable from '$lib/components/ParagraphEditable.svelte';
	import type { Paragraph } from '$lib/types/document';
	import { api } from '$lib/api/client';

	// Configuración de página (A4 en puntos)
	const PAGE_WIDTH = 595; // puntos
	const PAGE_HEIGHT = 842; // puntos
	const SCALE = 1.3; // Factor de escala para visualización
	const PADDING = 40; // Padding interno de la página

	let searchQuery = '';
	let showOnlyModified = false;
	let changesCount = 0;
	let viewMode: 'pages' | 'continuous' = 'pages'; // Nuevo: modo de vista
	let currentPage = 1;
	let zoomLevel = 100;

	interface PagedParagraph extends Paragraph {
		pageNumber: number;
		pagePosition?: number; // Posición dentro de la página
	}

	// Agrupar párrafos por página
	$: pages = groupParagraphsByPage($paragraphs);
	$: totalPages = Object.keys(pages).length;
	$: changesCount = $paragraphs.filter((p: Paragraph) => p.text !== p.original).length;

	// Filtrar párrafos
	$: filteredPages = filterPages(pages, searchQuery, showOnlyModified);

	function groupParagraphsByPage(paragraphsList: Paragraph[]): Record<number, PagedParagraph[]> {
		const grouped: Record<number, PagedParagraph[]> = {};
		
		paragraphsList.forEach((para, index) => {
			// Si el párrafo tiene info de página, usarla
			// Si no, estimarla basándose en el índice
			const pageNum = (para as any).page_number || Math.floor(index / 15) + 1; // ~15 párrafos por página
			
			if (!grouped[pageNum]) {
				grouped[pageNum] = [];
			}
			
			grouped[pageNum].push({
				...para,
				pageNumber: pageNum,
				pagePosition: grouped[pageNum].length
			});
		});
		
		return grouped;
	}

	function filterPages(
		pagesObj: Record<number, PagedParagraph[]>,
		query: string,
		onlyModified: boolean
	): Record<number, PagedParagraph[]> {
		const filtered: Record<number, PagedParagraph[]> = {};
		
		Object.entries(pagesObj).forEach(([pageNum, paras]) => {
			const filteredParas = paras.filter((p) => {
				const matchesSearch = query === '' || 
					p.text.toLowerCase().includes(query.toLowerCase());
				const matchesFilter = !onlyModified || p.text !== p.original;
				return matchesSearch && matchesFilter;
			});
			
			if (filteredParas.length > 0) {
				filtered[Number(pageNum)] = filteredParas;
			}
		});
		
		return filtered;
	}

	// Manejar actualización de párrafo
	function handleParagraphUpdate(event: CustomEvent<{ id: string; newText: string }>) {
		const { id, newText } = event.detail;
		
		paragraphs.update(items => 
			items.map((p: Paragraph) => 
				p.id === id 
					? { ...p, text: newText, modified: newText !== p.original }
					: p
			)
		);
	}

	// Seleccionar párrafo
	function handleParagraphSelect(event: CustomEvent<{ paragraph: Paragraph }>) {
		selectedParagraph.set(event.detail.paragraph);
		
		// Ir a la página del párrafo seleccionado
		const para = event.detail.paragraph as PagedParagraph;
		if (para.pageNumber) {
			currentPage = para.pageNumber;
		}
	}

	// Guardar todos los cambios
	async function saveChanges() {
		const modifiedParagraphs = $paragraphs.filter((p: Paragraph) => p.modified);
		
		if (modifiedParagraphs.length === 0) {
			alert('No hay cambios para guardar');
			return;
		}

		try {
			const response = await api.post('/documents/save-changes', {
				document_id: $currentDocument?.id,
				paragraphs: modifiedParagraphs
			});

			if (response.data.success) {
				alert(`✅ ${modifiedParagraphs.length} cambios guardados exitosamente`);
				
				paragraphs.update(items =>
					items.map((p: Paragraph) => ({
						...p,
						original: p.text,
						modified: false
					}))
				);
			}
		} catch (error) {
			console.error('Error saving changes:', error);
			alert('❌ Error al guardar cambios');
		}
	}

	// Descartar todos los cambios
	function discardAllChanges() {
		if (!confirm('¿Estás seguro de descartar todos los cambios?')) {
			return;
		}

		paragraphs.update(items =>
			items.map((p: Paragraph) => ({
				...p,
				text: p.original,
				modified: false
			}))
		);
	}

	// Exportar cambios
	function exportChanges() {
		const modifiedParagraphs = $paragraphs.filter((p: Paragraph) => p.modified);
		
		const exportData = {
			document: $currentDocument?.name,
			exportDate: new Date().toISOString(),
			totalPages: totalPages,
			totalParagraphs: $paragraphs.length,
			modifiedParagraphs: modifiedParagraphs.length,
			changes: modifiedParagraphs.map(p => ({
				id: p.id,
				page: (p as PagedParagraph).pageNumber,
				original: p.original,
				modified: p.text
			}))
		};

		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `changes-${$currentDocument?.name || 'document'}-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// Navegación de páginas
	function goToPage(pageNum: number) {
		if (pageNum >= 1 && pageNum <= totalPages) {
			currentPage = pageNum;
			
			// Scroll suave a la página
			if (viewMode === 'pages') {
				const pageEl = document.getElementById(`page-${pageNum}`);
				if (pageEl) {
					pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
				}
			}
		}
	}

	// Zoom
	function adjustZoom(delta: number) {
		zoomLevel = Math.max(50, Math.min(200, zoomLevel + delta));
	}
</script>

<div class="analysis-container">
	<!-- Header -->
	<div class="header">
		<div class="header-info">
			<h1 class="document-title">
				📄 {$currentDocument?.name || 'Documento sin título'}
			</h1>
			<div class="stats">
				<span class="stat">
					📑 {totalPages} página{totalPages !== 1 ? 's' : ''}
				</span>
				<span class="stat">
					📝 {$paragraphs.length} párrafos
				</span>
				{#if changesCount > 0}
					<span class="stat changes">
						✏️ {changesCount} cambios
					</span>
				{/if}
			</div>
		</div>

		<div class="header-actions">
			{#if changesCount > 0}
				<button class="btn btn-secondary" on:click={discardAllChanges}>
					🗑️ Descartar
				</button>
				<button class="btn btn-primary" on:click={exportChanges}>
					💾 Exportar
				</button>
				<button class="btn btn-success" on:click={saveChanges}>
					✅ Guardar ({changesCount})
				</button>
			{/if}
		</div>
	</div>

	<!-- Toolbar -->
	<div class="toolbar">
		<!-- Búsqueda -->
		<input
			type="text"
			class="search-input"
			placeholder="🔍 Buscar en el documento..."
			bind:value={searchQuery}
		/>

		<!-- Filtros -->
		<label class="checkbox-label">
			<input type="checkbox" bind:checked={showOnlyModified} />
			Solo modificados ({changesCount})
		</label>

		<!-- Modo de vista -->
		<div class="view-mode-toggle">
			<button
				class="toggle-btn"
				class:active={viewMode === 'pages'}
				on:click={() => (viewMode = 'pages')}
				title="Vista por páginas"
			>
				📄 Páginas
			</button>
			<button
				class="toggle-btn"
				class:active={viewMode === 'continuous'}
				on:click={() => (viewMode = 'continuous')}
				title="Vista continua"
			>
				📜 Continuo
			</button>
		</div>

		<!-- Navegación de páginas -->
		{#if viewMode === 'pages'}
			<div class="page-navigation">
				<button
					class="nav-btn"
					on:click={() => goToPage(currentPage - 1)}
					disabled={currentPage <= 1}
				>
					◀
				</button>
				<span class="page-indicator">
					<input
						type="number"
						min="1"
						max={totalPages}
						bind:value={currentPage}
						on:change={() => goToPage(currentPage)}
						class="page-input"
					/>
					<span class="page-total">/ {totalPages}</span>
				</span>
				<button
					class="nav-btn"
					on:click={() => goToPage(currentPage + 1)}
					disabled={currentPage >= totalPages}
				>
					▶
				</button>
			</div>
		{/if}

		<!-- Zoom -->
		<div class="zoom-controls">
			<button class="zoom-btn" on:click={() => adjustZoom(-10)}>-</button>
			<span class="zoom-level">{zoomLevel}%</span>
			<button class="zoom-btn" on:click={() => adjustZoom(10)}>+</button>
		</div>
	</div>

	<!-- Contenido principal -->
	<div class="content-wrapper">
		<!-- Vista de páginas -->
		{#if viewMode === 'pages'}
			<div class="pages-container" style="--zoom: {zoomLevel / 100}">
				{#if Object.keys(filteredPages).length === 0}
					<div class="empty-state">
						<div class="empty-icon">📭</div>
						<p class="empty-text">
							{#if showOnlyModified}
								No hay párrafos modificados
							{:else if searchQuery}
								No se encontraron resultados para "{searchQuery}"
							{:else}
								No hay contenido para mostrar
							{/if}
						</p>
					</div>
				{:else}
					{#each Object.entries(filteredPages) as [pageNum, pageParagraphs]}
						<div
							id="page-{pageNum}"
							class="pdf-page"
							class:current={Number(pageNum) === currentPage}
							style="
								width: {PAGE_WIDTH * SCALE}px;
								min-height: {PAGE_HEIGHT * SCALE}px;
							"
						>
							<!-- Número de página -->
							<div class="page-number-badge">
								Página {pageNum}
								{#if pageParagraphs.some(p => p.text !== p.original)}
									<span class="page-modified-indicator">●</span>
								{/if}
							</div>

							<!-- Contenido de la página -->
							<div class="page-content" style="padding: {PADDING}px">
								{#each pageParagraphs as paragraph (paragraph.id)}
									<ParagraphEditable
										{paragraph}
										on:update={handleParagraphUpdate}
										on:select={handleParagraphSelect}
									/>
								{/each}
							</div>

							<!-- Footer de página -->
							<div class="page-footer">
								{pageParagraphs.length} párrafo{pageParagraphs.length !== 1 ? 's' : ''}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{:else}
			<!-- Vista continua con separadores de página -->
			<div class="continuous-container" style="--zoom: {zoomLevel / 100}">
				{#each Object.entries(filteredPages) as [pageNum, pageParagraphs], pageIndex}
					{#if pageIndex > 0}
						<div class="page-separator">
							<div class="separator-line"></div>
							<div class="separator-label">
								📄 Página {pageNum}
								{#if pageParagraphs.some(p => p.text !== p.original)}
									<span class="modified-badge">modificada</span>
								{/if}
							</div>
							<div class="separator-line"></div>
						</div>
					{:else}
						<div class="first-page-label">
							📄 Página {pageNum}
						</div>
					{/if}

					<div class="continuous-page-content">
						{#each pageParagraphs as paragraph (paragraph.id)}
							<ParagraphEditable
								{paragraph}
								on:update={handleParagraphUpdate}
								on:select={handleParagraphSelect}
							/>
						{/each}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Sidebar con info del párrafo seleccionado -->
		{#if $selectedParagraph}
			<div class="sidebar">
				<h3 class="sidebar-title">Información del párrafo</h3>
				<div class="sidebar-content">
					<div class="info-item">
						<strong>ID:</strong> {$selectedParagraph.id}
					</div>
					<div class="info-item">
						<strong>Página:</strong> {($selectedParagraph as PagedParagraph).pageNumber || '?'}
					</div>
					<div class="info-item">
						<strong>Fuente:</strong> {$selectedParagraph.style.font_name || 'No especificada'}
					</div>
					<div class="info-item">
						<strong>Tamaño:</strong>
						{$selectedParagraph.style.font_size 
							? `${($selectedParagraph.style.font_size / 12700).toFixed(1)}pt` 
							: 'No especificado'}
					</div>
					<div class="info-item">
						<strong>Formato:</strong>
						{$selectedParagraph.style.bold ? '🅱️ Negrita ' : ''}
						{$selectedParagraph.style.italic ? '🅸 Cursiva' : ''}
						{!$selectedParagraph.style.bold && !$selectedParagraph.style.italic ? 'Normal' : ''}
					</div>
					<div class="info-item">
						<strong>Alineación:</strong> {$selectedParagraph.style.alignment}
					</div>
					<div class="info-item">
						<strong>Caracteres:</strong> {$selectedParagraph.text.length}
					</div>
					<div class="info-item">
						<strong>Palabras:</strong> {$selectedParagraph.text.split(/\s+/).length}
					</div>
					<div class="info-item">
						<strong>Modificado:</strong>
						{$selectedParagraph.text !== $selectedParagraph.original ? '✅ Sí' : '❌ No'}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.analysis-container {
		width: 100%;
		min-height: 100vh;
		background-color: #f3f4f6;
		padding: 1rem;
	}

	.header {
		background: white;
		padding: 1.5rem;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		display: flex;
		justify-content: space-between;
		align-items: center;
		flex-wrap: wrap;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.document-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #111827;
		margin: 0;
	}

	.stats {
		display: flex;
		gap: 1rem;
		margin-top: 0.5rem;
		flex-wrap: wrap;
	}

	.stat {
		font-size: 0.875rem;
		color: #6b7280;
		padding: 0.25rem 0.75rem;
		background-color: #f3f4f6;
		border-radius: 9999px;
	}

	.stat.changes {
		background-color: #dbeafe;
		color: #1e40af;
		font-weight: 600;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.btn {
		padding: 0.5rem 1rem;
		border: none;
		border-radius: 0.375rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s;
		font-size: 0.875rem;
		white-space: nowrap;
	}

	.btn-primary {
		background-color: #3b82f6;
		color: white;
	}

	.btn-primary:hover {
		background-color: #2563eb;
		transform: translateY(-1px);
		box-shadow: 0 4px 6px rgba(59, 130, 246, 0.3);
	}

	.btn-success {
		background-color: #22c55e;
		color: white;
	}

	.btn-success:hover {
		background-color: #16a34a;
	}

	.btn-secondary {
		background-color: #ef4444;
		color: white;
	}

	.btn-secondary:hover {
		background-color: #dc2626;
	}

	/* Toolbar */
	.toolbar {
		background: white;
		padding: 1rem;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		display: flex;
		gap: 1rem;
		align-items: center;
		margin-bottom: 1rem;
		flex-wrap: wrap;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
		padding: 0.5rem 1rem;
		border: 1px solid #d1d5db;
		border-radius: 0.375rem;
		font-size: 0.875rem;
	}

	.search-input:focus {
		outline: none;
		border-color: #3b82f6;
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: #374151;
		cursor: pointer;
		white-space: nowrap;
	}

	.view-mode-toggle {
		display: flex;
		background-color: #f3f4f6;
		border-radius: 0.375rem;
		padding: 0.25rem;
	}

	.toggle-btn {
		padding: 0.375rem 0.75rem;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		font-weight: 500;
		color: #6b7280;
		transition: all 0.2s;
		white-space: nowrap;
	}

	.toggle-btn.active {
		background-color: white;
		color: #111827;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.toggle-btn:hover:not(.active) {
		color: #111827;
	}

	/* Navegación de páginas */
	.page-navigation {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background-color: #f3f4f6;
		padding: 0.25rem 0.75rem;
		border-radius: 0.375rem;
	}

	.nav-btn {
		padding: 0.25rem 0.5rem;
		border: none;
		background: white;
		cursor: pointer;
		border-radius: 0.25rem;
		font-weight: 600;
		transition: all 0.2s;
	}

	.nav-btn:hover:not(:disabled) {
		background-color: #e5e7eb;
	}

	.nav-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.page-indicator {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.875rem;
	}

	.page-input {
		width: 50px;
		padding: 0.25rem 0.5rem;
		border: 1px solid #d1d5db;
		border-radius: 0.25rem;
		text-align: center;
		font-size: 0.875rem;
	}

	.page-total {
		color: #6b7280;
	}

	/* Zoom */
	.zoom-controls {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background-color: #f3f4f6;
		padding: 0.25rem 0.75rem;
		border-radius: 0.375rem;
	}

	.zoom-btn {
		padding: 0.25rem 0.5rem;
		border: none;
		background: white;
		cursor: pointer;
		border-radius: 0.25rem;
		font-weight: 600;
		width: 30px;
		transition: all 0.2s;
	}

	.zoom-btn:hover {
		background-color: #e5e7eb;
	}

	.zoom-level {
		font-size: 0.875rem;
		color: #374151;
		min-width: 45px;
		text-align: center;
	}

	/* Contenido */
	.content-wrapper {
		display: grid;
		grid-template-columns: 1fr 300px;
		gap: 1rem;
	}

	/* Vista de páginas */
	.pages-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		padding: 2rem 0;
		transform: scale(var(--zoom));
		transform-origin: top center;
	}

	.pdf-page {
		background: white;
		box-shadow:
			0 4px 6px rgba(0, 0, 0, 0.1),
			0 1px 3px rgba(0, 0, 0, 0.08);
		border-radius: 4px;
		position: relative;
		transition: all 0.3s ease;
	}

	.pdf-page.current {
		box-shadow:
			0 10px 25px rgba(59, 130, 246, 0.3),
			0 6px 12px rgba(59, 130, 246, 0.2);
		border: 2px solid #3b82f6;
	}

	.page-number-badge {
		position: absolute;
		top: -12px;
		left: 50%;
		transform: translateX(-50%);
		background: linear-gradient(135deg, #3b82f6, #2563eb);
		color: white;
		padding: 0.25rem 1rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 600;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		z-index: 10;
	}

	.page-modified-indicator {
		color: #fbbf24;
		font-size: 1rem;
		animation: pulse 2s infinite;
	}

	.page-content {
		position: relative;
		overflow: hidden;
	}

	.page-footer {
		padding: 0.75rem;
		border-top: 1px solid #e5e7eb;
		text-align: center;
		font-size: 0.75rem;
		color: #9ca3af;
		background-color: #f9fafb;
		border-radius: 0 0 4px 4px;
	}

	/* Vista continua */
	.continuous-container {
		background: white;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		padding: 2rem;
		transform: scale(var(--zoom));
		transform-origin: top left;
	}

	.page-separator {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: 3rem 0;
	}

	.separator-line {
		flex: 1;
		height: 2px;
		background: linear-gradient(to right, transparent, #e5e7eb, transparent);
	}

	.separator-label {
		font-size: 0.875rem;
		font-weight: 600;
		color: #6b7280;
		background-color: #f3f4f6;
		padding: 0.5rem 1rem;
		border-radius: 9999px;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
	}

	.modified-badge {
		background-color: #dbeafe;
		color: #1e40af;
		padding: 0.125rem 0.5rem;
		border-radius: 9999px;
		font-size: 0.75rem;
	}

	.first-page-label {
		font-size: 1.125rem;
		font-weight: 600;
		color: #111827;
		margin-bottom: 1.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 2px solid #e5e7eb;
	}

	.continuous-page-content {
		margin-bottom: 1rem;
	}

	/* Sidebar */
	.sidebar {
		background: white;
		padding: 1.5rem;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
		height: fit-content;
		position: sticky;
		top: 1rem;
	}

	.sidebar-title {
		font-size: 1.125rem;
		font-weight: 700;
		margin-bottom: 1rem;
		color: #111827;
	}

	.sidebar-content {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.info-item {
		font-size: 0.875rem;
		padding: 0.5rem;
		background-color: #f9fafb;
		border-radius: 0.25rem;
	}

	.info-item strong {
		color: #374151;
		display: block;
		margin-bottom: 0.25rem;
	}

	/* Empty state */
	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		color: #9ca3af;
		background: white;
		border-radius: 0.5rem;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-text {
		font-size: 1rem;
	}

	/* Animations */
	@keyframes pulse {
		0%, 100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	/* Responsive */
	@media (max-width: 1400px) {
		.content-wrapper {
			grid-template-columns: 1fr;
		}

		.sidebar {
			position: relative;
			top: 0;
		}
	}

	@media (max-width: 768px) {
		.toolbar {
			flex-direction: column;
			align-items: stretch;
		}

		.search-input {
			width: 100%;
		}

		.view-mode-toggle,
		.page-navigation,
		.zoom-controls {
			width: 100%;
			justify-content: center;
		}

		.pdf-page {
			width: 100% !important;
			min-height: auto !important;
		}
	}
</style>