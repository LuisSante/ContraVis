import axios from 'axios';

/**
 * Cliente HTTP del frontend.
 *
 * `baseURL` es relativo (`/api/v1`): el navegador llama same-origin y Next hace
 * de proxy al backend (ver `next.config.ts` → rewrites), evitando CORS. El
 * interceptor inyecta `Authorization: Token <key>` cuando hay un token disponible
 * — andamiaje para una futura capa de login.
 */
export const api = axios.create({
	baseURL: process.env.NEXT_PUBLIC_API_BASE ?? '/api/v1',
	withCredentials: false,
});

api.interceptors.request.use((config) => {
	const token = process.env.NEXT_PUBLIC_API_TOKEN;
	if (token) {
		config.headers.set('Authorization', `Token ${token}`);
	}
	return config;
});
