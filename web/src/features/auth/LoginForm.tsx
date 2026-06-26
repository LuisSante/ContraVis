import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card';

/**
 * Stub de login (andamiaje). El backend aún no expone autenticación; este
 * formulario existe para fijar la ruta `(auth)/login` y el layout. La lógica
 * real (envío de credenciales, token en `@/lib/api`) se implementará cuando el
 * backend tenga auth.
 */
export function LoginForm() {
	return (
		<Card className="w-full max-w-sm">
			<CardHeader>
				<CardTitle>Sign in</CardTitle>
				<CardDescription>Acceso a ContraVis (pendiente de backend).</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Input type="email" placeholder="Email" disabled />
				<Input type="password" placeholder="Password" disabled />
				<Button className="w-full" disabled>
					Sign in
				</Button>
			</CardContent>
		</Card>
	);
}
