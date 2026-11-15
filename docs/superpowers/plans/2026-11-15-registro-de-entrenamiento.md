# Plan de implementación del registro de entrenamiento

La especificación de registro de entrenamiento define el alcance. La SPA móvil se construye con Vite y React. Supabase almacena las cuentas, el catálogo, los entrenamientos finalizados, las rutinas y los enlaces compartidos. Una copia local por cuenta conserva el entrenamiento abierto y los cambios pendientes.

1. Escribir y ejecutar las pruebas de comparación por serie, repetición de entrenamientos y deduplicación de fichas. Implementar las reglas en `src/training.js` y repetir las pruebas.
2. Crear la migración de Supabase. Probar registro autorizado, permisos por cuenta, inserciones repetidas y copia idempotente de rutinas mediante enlaces.
3. Implementar el registro móvil, catálogo, historial, comparación, rutinas y sesión. Mantener los cambios guardados localmente hasta confirmarlos en Supabase. Añadir la caché de la aplicación al build de producción.
4. Verificar la compilación, las pruebas, el flujo móvil y la apertura sin red. Documentar la configuración de Supabase y Vercel. Subir el resultado a `main`.
