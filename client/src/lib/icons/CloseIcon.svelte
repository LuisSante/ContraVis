<script lang="ts">
	export let className = 'h-4 w-4';
	export let strokeWidth: number | string = 2;
	export let color = 'currentColor';
	export let size: number | string = 24;
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	width={size}
	height={size}
	class={className}
	stroke={color}
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	{...$$restProps}
>
	<path d="M6 6l12 12M18 6 6 18" />
</svg>
