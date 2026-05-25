import axios from 'axios';
import { env } from '$env/dynamic/public';

const baseURL = env.PUBLIC_DEV_LOCAL || 'http://localhost:8300/api/v1';

export const api = axios.create({
	baseURL,
	withCredentials: false
});
