'use client';

import { useDocumentStore } from '@/stores/document';

/**
 * Indicador flotante de carga (reemplaza el overlay con `transition:fade` del
 * antiguo `+layout.svelte`). Se muestra mientras `loading` está activo en el store.
 */
export function LoadingOverlay() {
	const loading = useDocumentStore((state) => state.loading);

	if (!loading) return null;

	return (
		<div
			className="pointer-events-none fixed top-4 right-4 z-50 flex animate-in fade-in items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-xl ring-1 ring-black/5"
			role="status"
			aria-live="polite"
		>
			<div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-transparent" />
			Loading...
		</div>
	);
}
