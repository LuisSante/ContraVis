// Motor compartido del "acercar con Shift + Scroll": mantiene un valor de
// compresión (0→1), lo anima con un tween RAF (easing cúbico) al hacer
// Shift+Scroll y reprograma un recálculo en scroll/resize/ResizeObserver del host.
// Lo usan el puente de related y la compresión de evidencia de contradicción; cada
// uno solo aporta su `refresh` (qué recalcular), su `durationMs` y, opcionalmente,
// `canCompress` (cuándo permitir el gesto).

const COMPRESS_SNAP_EPSILON = 0.001;
const WHEEL_DIRECTION_DEADZONE = 2;

interface AttachShiftWheelCompressionOptions {
	host: HTMLElement;
	/** Duración del tween en ms (related: 560, contradicción: 420). */
	durationMs: number;
	/** Recalcula con el valor de compresión actual (compute + setState + clases). */
	refresh: (compression: number) => void;
	/** Si devuelve false, el Shift+Scroll no comprime (deja el scroll normal). */
	canCompress?: () => boolean;
}

/**
 * Engancha el motor de compresión al host y devuelve la función de limpieza.
 * Llamar dentro de un `useEffect` (el ciclo de vida/deps lo gobierna el hook que
 * lo usa). Un `cleanup()` cancela el tween, los RAF y quita los listeners.
 */
export function attachShiftWheelCompression({
	host,
	durationMs,
	refresh,
	canCompress,
}: AttachShiftWheelCompressionOptions): () => void {
	let compression = 0;
	let target = 0;
	let frame: number | null = null;
	let tween: number | null = null;

	const schedule = () => {
		if (frame != null) cancelAnimationFrame(frame);
		frame = requestAnimationFrame(() => {
			frame = null;
			refresh(compression);
		});
	};

	const animate = (timestamp: number, startValue: number, startTime: number) => {
		const elapsed = timestamp - startTime;
		const linearProgress = Math.max(0, Math.min(1, elapsed / durationMs));
		const easedProgress =
			linearProgress < 0.5
				? 4 * linearProgress * linearProgress * linearProgress
				: 1 - Math.pow(-2 * linearProgress + 2, 3) / 2;
		compression = startValue + (target - startValue) * easedProgress;
		refresh(compression);

		const delta = Math.abs(target - compression);
		if (linearProgress >= 1 || delta <= COMPRESS_SNAP_EPSILON) {
			compression = target;
			tween = null;
			refresh(compression);
			return;
		}
		tween = requestAnimationFrame((next) => animate(next, startValue, startTime));
	};

	const handleWheel = (event: WheelEvent) => {
		if (!event.shiftKey) return;
		if (canCompress && !canCompress()) return;
		const wheelDelta =
			Math.abs(event.deltaY) >= WHEEL_DIRECTION_DEADZONE ? event.deltaY : event.deltaX;
		if (Math.abs(wheelDelta) < WHEEL_DIRECTION_DEADZONE) return;
		event.preventDefault();
		const nextTarget = wheelDelta > 0 ? 1 : 0;
		if (nextTarget === target && tween != null) return;

		target = nextTarget;
		const startValue = compression;
		const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
		if (tween != null) {
			cancelAnimationFrame(tween);
			tween = null;
		}
		tween = requestAnimationFrame((next) => animate(next, startValue, startTime));
	};

	schedule();
	host.addEventListener('scroll', schedule, { passive: true });
	window.addEventListener('resize', schedule);
	host.addEventListener('wheel', handleWheel, { passive: false });
	const observer = new ResizeObserver(schedule);
	observer.observe(host);

	return () => {
		host.removeEventListener('scroll', schedule);
		window.removeEventListener('resize', schedule);
		host.removeEventListener('wheel', handleWheel);
		observer.disconnect();
		if (frame != null) cancelAnimationFrame(frame);
		if (tween != null) cancelAnimationFrame(tween);
	};
}
