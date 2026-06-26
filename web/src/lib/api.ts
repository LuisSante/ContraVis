import axios from 'axios';

/**
 * Cliente HTTP del frontend.
 *
 * `baseURL` apunta al backend ContraVis (`NEXT_PUBLIC_DEV_LOCAL`). El interceptor
 * inyecta `Authorization: Token <key>` cuando hay un token disponible — hoy el
 * backend no exige auth, así que esto es andamiaje para una futura capa de login.
 */
export const api = axios.create({
	baseURL: process.env.NEXT_PUBLIC_DEV_LOCAL,
	withCredentials: false,
});

api.interceptors.request.use((config) => {
	const token = process.env.NEXT_PUBLIC_API_TOKEN;
	if (token) {
		config.headers.set('Authorization', `Token ${token}`);
	}
	return config;
});
