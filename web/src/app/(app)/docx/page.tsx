import { Suspense } from 'react';
import { DocxViewer } from '@/features/docx/components/shell/DocxViewer';
import '@/features/docx/styles/docx-viewer.css';

type DocxSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

/**
 * Página del visor docx. Server Component fino: reenvía la promesa de
 * `searchParams` al cliente (patrón listo para Cache Components — no se hace
 * `await searchParams` en el top de la página) y la desenvuelve dentro de un
 * límite `<Suspense>`.
 */
export default function DocxPage({ searchParams }: { searchParams: DocxSearchParams }) {
	return (
		<Suspense fallback={<DocxViewerFallback />}>
			<DocxViewer searchParams={searchParams} />
		</Suspense>
	);
}

function DocxViewerFallback() {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<p className="text-muted-foreground text-sm">Cargando documento…</p>
		</div>
	);
}
