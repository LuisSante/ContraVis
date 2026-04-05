<script lang="ts">
	export let className = 'h-4 w-4';
	export let strokeWidth: number | string = 1.8;
	export let color = 'currentColor';
	export let size: number | string = 24;
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	class={className}
	color={color}
	fill="none"
	stroke={color}
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	{...$$restProps}
>
	<path d="M3 6H21" />
	<path d="M6 12H18" />
	<path d="M9 18H15" />
</svg>
