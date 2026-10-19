/**
 * Cierre de sesión del panel con alcance LOCAL: solo invalida la sesión de este
 * navegador. El alcance global (el predeterminado) revocaría todas las sesiones
 * del usuario, incluida la que pudiera tener en la tienda con el mismo correo.
 */
export type ClienteConSignOut = {
  auth: { signOut(opciones?: { scope: 'local' | 'global' | 'others' }): Promise<unknown> };
};

export async function cerrarSesionLocal(cliente: ClienteConSignOut): Promise<void> {
  await cliente.auth.signOut({ scope: 'local' });
}
