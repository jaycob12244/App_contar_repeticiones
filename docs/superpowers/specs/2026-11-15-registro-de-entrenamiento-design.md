# Registro de entrenamiento

## Objetivo

Reemplazar las notas del teléfono con un registro rápido de ejercicios, series y repeticiones. La aplicación está pensada para personas que ya entrenan. Se diseñará primero para pantallas de teléfono, se podrá abrir desde un icono en la pantalla de inicio y se verificará en iPhone y Android. Usará Supabase y Rivera hará el despliegue en Vercel.

## Entrenamiento

- Desde la pantalla de inicio se puede empezar un entrenamiento nuevo, retomar el que está en curso o repetir el último finalizado.
- Para iniciar uno nuevo se elige uno o varios grupos musculares, como pecho, espalda, parte delantera de pierna, parte trasera de pierna y abdomen. Después se buscan y agregan ejercicios. Se pueden sumar o cambiar ejercicios durante el entrenamiento.
- Al repetir un entrenamiento se copian sus grupos musculares y el orden de sus ejercicios. Las series se registran de nuevo. Durante el registro se puede consultar el número de series y el detalle de la última sesión que incluya el ejercicio.
- Se añade una serie a la vez. Cada serie guarda sus repeticiones iniciales, su carga en kilos o placas, y el RIR y la marca de fallo cuando la persona decida anotarlos. Para ejercicios de peso corporal se puede elegir «Sin carga externa». El RIR se puede registrar en todas las series. Cero es un valor válido y se distingue de un campo vacío. Durante el entrenamiento se pueden corregir o quitar series.
- Una serie puede tener varios tramos de *rest-pause* y de *drop set*, en el orden en que se hicieron. Cada *rest-pause* guarda sus repeticiones y conserva la carga del tramo anterior. Cada tramo de *drop set* guarda repeticiones y carga. La serie y cada carga registrada usan una sola unidad. La cantidad de placas no requiere conocer su peso en kilos.
- Los controles para agregar intensificadores están disponibles dentro de la serie. Cada tramo pertenece a esa serie y la cantidad total de series se mantiene. El entrenamiento queda disponible en el historial al finalizarlo.

Ejemplo de registro de una serie

- Serie 1 · 8 repeticiones · 10 placas · RIR 0
  - Rest-pause · 3 repeticiones
  - Rest-pause · 2 repeticiones
  - Drop set · 5 repeticiones · 7 placas

## Historial y progreso

La pantalla de historial muestra los entrenamientos por fecha. Desde progreso se puede buscar por grupo muscular y ejercicio, consultar las dos últimas sesiones que incluyeron el ejercicio y ver las repeticiones iniciales de sus series en orden.

Se consideraron dos presentaciones. Una gráfica por fechas permite consultar tendencias. Una comparación textual por serie permite ver exactamente dónde cambió el rendimiento respecto a la sesión anterior. La primera versión usará la comparación textual. Cuando las series correspondientes tengan la misma carga y unidad, se mostrará la diferencia en repeticiones y, si todas las series son comparables, la diferencia total.

| Jalón al pecho · 10 placas | Anterior | Actual | Cambio |
| --- | ---: | ---: | ---: |
| Serie 1 | 10 | 11 | +1 |
| Serie 2 | 9 | 10 | +1 |
| Serie 3 | 8 | 9 | +1 |
| Total | 27 | 30 | +3 |

Si cambia la carga o la unidad, se muestran ambos valores y se indica el cambio de carga. Dos series de un mismo ejercicio con «Sin carga externa» se pueden comparar. Las series que solo existen en una sesión se muestran sin diferencia calculada. El RIR, el fallo y las repeticiones de intensificadores quedan fuera del cálculo. Si el ejercicio tiene una sola sesión registrada, se muestra esa sesión y el estado «Todavía no hay un entrenamiento anterior».

## Catálogo, cuentas y privacidad

- El catálogo inicial incluye ejercicios agrupados por músculo. Cada cuenta autorizada puede buscar y agregar ejercicios. Al sincronizarse, un ejercicio nuevo queda disponible para todas las cuentas con el nombre visible de quien lo agregó. Los ejercicios del catálogo inicial no requieren autor.
- Antes de agregar un ejercicio se muestran coincidencias. Supabase aplica una restricción de unicidad sobre un nombre normalizado, ignorando mayúsculas, tildes y variaciones de espacios. Si dos personas agregan el mismo nombre, se conserva una sola ficha, con su autor original, y ambas pueden usarla en sus entrenamientos.
- Si se quiere seguir el progreso de un mismo movimiento en máquinas con placas distintas, se puede especificar la máquina en el nombre de cada variante. El historial y el progreso se consultan por ficha del catálogo.
- El registro usa correo y contraseña con Supabase Auth. Se configurarán inicialmente tres direcciones autorizadas en una lista privada que se puede actualizar. La lista determina quién puede registrarse. El hook `Before User Created` rechaza otros correos desde Supabase. Cada persona verifica su correo, elige su contraseña y registra un nombre visible para la autoría del catálogo. [Documentación de Supabase Auth](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- La sesión se conserva entre aperturas mientras sea válida. Los entrenamientos, las series y las rutinas pertenecen a su cuenta. Las reglas de acceso de Supabase deben aplicar esa propiedad también cuando una solicitud llega directamente a la base de datos a través de la API. En el catálogo se muestra el nombre visible del autor.

## Teléfono y funcionamiento sin conexión

- La web tendrá un manifiesto, iconos y un *service worker* para abrirla desde la pantalla de inicio y cargar la interfaz sin conexión tras la primera visita con inicio de sesión. La interfaz usa blanco y negro, modo oscuro, botones cómodos para tocar y animaciones discretas que respetan la preferencia de movimiento reducido.
- Tras iniciar sesión con conexión, la aplicación guarda en el dispositivo el catálogo, las rutinas, el entrenamiento activo, el último entrenamiento finalizado y la última sesión disponible de cada ejercicio que se haya registrado. Ya en modo avión, se puede abrir desde el icono, empezar o retomar un entrenamiento, registrar series, crear un ejercicio y finalizar el entrenamiento.
- El navegador guarda los cambios localmente antes de considerarlos guardados. La app conserva los cambios pendientes al cerrar y volver a abrir, y sincroniza al recuperar conexión con la app abierta o al abrirla de nuevo. Reintentar el envío conserva el mismo identificador y no duplica registros. Una colisión de nombres en el catálogo enlaza las series pendientes al ejercicio compartido existente.
- Se indica cuándo hay cambios guardados en el teléfono pendientes de sincronizar. Si caduca la sesión y se requiere autenticación, la sincronización continúa cuando la misma cuenta se autentica. Los datos locales y la cola se aíslan por cuenta.

## Decisiones propuestas para la primera versión

- La comparación de progreso empareja series por su orden y calcula un total cuando todas las series comparadas tienen pares con la misma carga y unidad.
- Las rutinas guardadas son plantillas privadas con nombre, grupos musculares y ejercicios ordenados. Pueden guardarse a partir de un entrenamiento y usarse al iniciar otro. El titular puede compartir una copia de la plantilla mediante un enlace. Otra cuenta autorizada puede importar esa copia a sus rutinas privadas. Se requiere conexión para crear e importar enlaces. Las copias son independientes y conservan la plantilla compartida en ese momento.
- La primera versión guarda y consulta los entrenamientos finalizados. La edición del historial queda para una ampliación.
- Vercel alojará la web compilada con Vite. La interfaz usa React. Supabase maneja las cuentas, los permisos y los datos. El teléfono guarda los cambios en una cola local por cuenta y un service worker conserva los archivos que permiten abrir la web sin conexión.

## Criterios de aceptación

1. En un iPhone y en un Android se puede abrir la web desde el icono de la pantalla de inicio y registrar un entrenamiento completo.
2. Un correo autorizado puede crear su cuenta y elegir contraseña. Un correo ajeno a la lista recibe un rechazo incluso si intenta registrarse directamente con Supabase Auth. Dos cuentas autorizadas pueden usar el mismo catálogo, y cada una solo puede consultar sus entrenamientos y rutinas.
3. Tres series guardan tres valores independientes de RIR. Una serie con dos *rest-pauses* y un *drop set* sigue contando como una sola y conserva sus tramos en orden.
4. Tras una primera apertura con sesión iniciada y datos cargados, se puede cerrar la web, activar el modo avión, abrirla desde el icono y registrar un entrenamiento. Se comprueba que el registro sobrevive a otro cierre y que se sincroniza una sola vez cuando vuelve la conexión.
5. Si el catálogo recibe dos altas para nombres equivalentes, conserva una ficha y todos los registros de entrenamiento quedan vinculados a ella.
6. Con series de 10, 9 y 8 repeticiones en la sesión anterior y 11, 10 y 9 en la actual, a igual carga, se muestran tres cambios de +1 y un total de +3. Las repeticiones añadidas en un intensificador no alteran el resultado.
7. Una cuenta autorizada puede importar la rutina desde su enlace y usarla en un entrenamiento. Abrir de nuevo el mismo enlace devuelve la copia existente. El enlace únicamente da acceso a la plantilla compartida.
