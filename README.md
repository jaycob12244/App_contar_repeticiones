# Entreno

Web móvil para registrar series, repeticiones, carga, RIR y técnicas de intensidad. Permite comparar las dos últimas sesiones de un ejercicio, guardar rutinas y compartir una copia con otra cuenta autorizada mediante un enlace. Tras iniciar sesión y completar la primera sincronización, se pueden abrir y registrar entrenamientos sin conexión.

## Supabase

1. Crea un proyecto de Supabase y aplica en orden la [migración inicial](supabase/migrations/20261115215438_training_diary.sql) y la [migración de permisos para eliminar registros propios](supabase/migrations/20261115230930_allow_owned_record_deletion.sql) en el SQL Editor.
2. Desde el SQL Editor, agrega los correos reales de las personas autorizadas. Sustituye los ejemplos antes de ejecutar esta consulta.

   ```sql
   insert into private.allowed_emails (email)
   values
     ('primera@example.com'),
     ('segunda@example.com'),
     ('tercera@example.com')
   on conflict (email) do nothing;
   ```

3. En **Authentication → Auth Hooks**, activa **Before User Created** y selecciona la función Postgres `private.before_user_created`. Mantén el esquema `private` fuera de los esquemas expuestos por la Data API. [Configurar el hook de registro](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
4. Habilita el proveedor de correo y la confirmación de correo en Supabase Auth. Configura SMTP para entregar mensajes de confirmación y recuperación a las cuentas autorizadas. El servicio de correo predeterminado solo envía a miembros del equipo del proyecto. [Configurar SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
5. En **Authentication → URL Configuration**, configura la URL pública de Vercel como **Site URL**. Si usarás desarrollo local, autoriza también `http://localhost:5173/**` como URL de retorno. [Configurar URLs de retorno](https://supabase.com/docs/guides/auth/redirect-urls)

## Desarrollo y Vercel

Usa Node.js 24. Para ejecutar localmente, copia [las variables de ejemplo](.env.example) a `.env.local` y coloca la URL del proyecto y su clave publicable.

```sh
npm ci
npm run dev
```

En Vercel, importa el repositorio y agrega `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con esos mismos valores. La configuración del repositorio compila con Vite y sirve `dist`.

En iPhone, abre la URL desplegada en Safari y elige **Compartir → Agregar a pantalla de inicio**. En Android, usa la opción de instalación o de agregar a la pantalla de inicio en el menú del navegador. Abre una vez el icono con internet, inicia sesión y espera a que aparezca **Sincronizado** antes de probar el modo avión.

## Pruebas

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`npm test` ejecuta las reglas de entrenamiento y la migración en una instancia local de Postgres con roles de Auth de prueba. La prueba de navegador usa una API de prueba para verificar el registro móvil, la reapertura sin conexión, la sincronización y el uso compartido de rutinas. En Windows puede usar Edge instalado configurando `PLAYWRIGHT_CHANNEL=msedge`.
