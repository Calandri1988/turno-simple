# Estado actual del proyecto

Este documento describe el estado real de la app de turnos online en este momento. La app ya usa backend con Node.js, Express y SQLite. El frontend sigue siendo HTML, CSS y JavaScript simple, sin frameworks.

## Arquitectura

- `server.js`: backend Express, inicializacion de SQLite, migraciones simples, seed de datos, reglas de disponibilidad y endpoints API.
- `app.js`: frontend del flujo tipo chat, panel admin, carga de datos desde API y calculo visual de horarios disponibles.
- `index.html`: estructura principal de la app.
- `styles.css`: estilos visuales del chat, botones, formulario y panel admin.
- `turnos.sqlite`: base de datos SQLite local.
- `package.json`: scripts y dependencias (`express`, `sqlite`, `sqlite3`).

La app corre localmente con:

```bash
npm start
```

El backend sirve tambien los archivos estaticos del frontend desde la misma carpeta.

## Tablas SQLite

### `services`

Guarda los servicios disponibles.

Columnas:

- `id TEXT PRIMARY KEY`
- `name TEXT NOT NULL`
- `duration_minutes INTEGER NOT NULL`
- `price REAL`

Servicios actuales:

- `consulta`: Consulta, 30 minutos
- `corte`: Corte, 45 minutos
- `asesoria`: Asesoria, 60 minutos

### `professionals`

Guarda los profesionales.

Columnas:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `name TEXT NOT NULL UNIQUE`

Profesionales actuales:

- Ana Torres
- Bruno Ruiz
- Clara Gomez

### `professional_schedules`

Guarda bloques reales de agenda por profesional y dia. Ya no depende del servicio.

Columnas:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `professional_id INTEGER NOT NULL`
- `day TEXT NOT NULL`
- `start_time TEXT NOT NULL`
- `end_time TEXT NOT NULL`
- `interval_minutes INTEGER NOT NULL`
- `FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE`
- `UNIQUE(professional_id, day, start_time, end_time, interval_minutes)`

Comportamiento actual:

- La tabla se crea si no existe.
- Los datos de prueba se siembran solo si la tabla esta vacia.
- No se borra en cada inicio, por lo que los bloques persisten.

### `reservations`

Guarda las reservas confirmadas.

Columnas:

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `service_id TEXT NOT NULL`
- `service_name TEXT NOT NULL`
- `professional_id INTEGER NOT NULL`
- `professional_name TEXT NOT NULL`
- `day TEXT NOT NULL`
- `time TEXT NOT NULL`
- `duration_minutes INTEGER NOT NULL DEFAULT 30`
- `customer_name TEXT NOT NULL`
- `customer_phone TEXT NOT NULL`
- `created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`
- `FOREIGN KEY (professional_id) REFERENCES professionals(id)`
- `UNIQUE(professional_id, day, time)`

Notas:

- `duration_minutes` se guarda en la reserva al momento de crearla.
- Esto conserva la duracion efectiva aunque despues cambie la duracion del servicio.
- La restriccion unica evita dos reservas con el mismo profesional, dia y hora exacta.
- La regla real de solapamiento se valida por backend comparando rangos de tiempo.

## Endpoints API

### `GET /api/services`

Devuelve los servicios ordenados por nombre.

### `GET /api/professionals`

Devuelve profesionales con sus bloques de agenda.

Cada profesional incluye:

- `id`
- `name`
- `schedules`

Cada bloque incluye:

- `day`
- `startTime`
- `endTime`
- `intervalMinutes`

### `GET /api/reservations`

Devuelve todas las reservas ordenadas por dia, horario y profesional.

### `POST /api/reservations`

Crea una reserva.

Campos esperados:

- `serviceId`
- `professionalId`: entero positivo si se eligio profesional especifico, o `null`/vacio si se eligio "Cualquiera disponible"
- `day`
- `time`
- `customerName`
- `customerPhone`

El backend ignora el `serviceName` recibido desde frontend y toma el nombre real desde la tabla `services`.

### `DELETE /api/reservations/:id`

Cancela una reserva individual.

### `DELETE /api/reservations`

Borra todas las reservas. Se usa para limpiar turnos de prueba desde el panel admin.

## Flujo completo del cliente

1. La app carga servicios, profesionales y reservas desde el backend.
2. El chat saluda al usuario y muestra botones de servicios.
3. El cliente elige un servicio.
4. La app muestra profesionales disponibles para ese servicio y la opcion "Cualquiera disponible".
5. El cliente elige profesional especifico o cualquiera disponible.
6. La app muestra solo dias con al menos un horario posible.
7. El cliente elige dia.
8. La app muestra horarios disponibles calculados desde bloques de agenda, duracion del servicio y reservas existentes.
9. El cliente elige horario.
10. La app pide nombre y telefono.
11. El cliente confirma.
12. El backend vuelve a validar todo antes de insertar.
13. Si la reserva se crea, el frontend muestra resumen final con:
    - nombre
    - telefono
    - servicio
    - profesional asignado
    - dia
    - horario
14. El boton "Reservar otro turno" reinicia el flujo.

No hay escritura libre para elegir servicio, profesional, dia u horario. Esos pasos siguen cerrados con botones.

## Flujo admin

El panel admin esta en la misma pantalla, sin login.

Permite:

- Ver todas las reservas en memoria del frontend cargadas desde SQLite.
- Verlas agrupadas y ordenadas por dia y horario.
- Cancelar una reserva individual.
- Borrar todas las reservas de prueba.

Cada accion admin llama al backend y luego actualiza la lista local del frontend.

## Logica de disponibilidad en frontend

El frontend calcula disponibilidad para mostrar botones, pero no es la fuente definitiva de verdad. La validacion final siempre ocurre en backend.

Para generar horarios:

1. Toma los bloques del profesional para el dia.
2. Convierte `startTime` y `endTime` a minutos.
3. Avanza desde `startTime` hasta antes de `endTime` usando `intervalMinutes`.
4. Solo incluye un horario si `inicio + durationMinutes <= endTime`.
5. Filtra horarios que se solapan con reservas existentes del mismo profesional y dia.

Para "Cualquiera disponible":

- Une los horarios disponibles de todos los profesionales.
- Elimina duplicados.
- Muestra cada horario una sola vez.

## Logica de disponibilidad en backend

El backend decide si una reserva puede crearse.

Validaciones principales:

1. El servicio debe existir en `services`.
2. Dia, horario, nombre y telefono no pueden estar vacios.
3. El horario debe tener formato estricto `HH:MM`.
4. El horario debe estar en rango `00:00` a `23:59`.
5. Si `professionalId` viene informado, debe ser un entero positivo valido.
6. Si se eligio profesional especifico, ese profesional debe tener un bloque que contenga todo el rango de la reserva.
7. El horario debe estar alineado al `interval_minutes` del bloque correspondiente.
8. El rango de la nueva reserva no debe solaparse con otra reserva del mismo profesional y dia.
9. La validacion de disponibilidad y el `INSERT` se ejecutan dentro de una transaccion SQLite con `BEGIN IMMEDIATE TRANSACTION`.

## Duracion de servicios

La duracion viene de `services.duration_minutes`.

Al crear una reserva:

- El backend busca el servicio en SQLite.
- Usa la duracion actual del servicio para validar disponibilidad.
- Guarda esa duracion en `reservations.duration_minutes`.

Al validar solapamientos:

- El backend usa `reservations.duration_minutes` guardado en cada reserva existente.
- No recalcula la duracion desde `services`.

Esto evita que una reserva vieja cambie de duracion si luego se modifica el servicio.

## Reglas de solapamiento

Cada reserva ocupa un rango:

```text
inicio = time
fin = time + duration_minutes
```

Dos rangos se solapan si:

```text
inicio_nuevo < fin_existente
inicio_existente < fin_nuevo
```

Ejemplo:

- Reserva existente: 09:00 a 10:00
- Nueva reserva 09:30 a 10:00: se rechaza
- Nueva reserva 10:00 a 10:30: se acepta

La regla se aplica por:

- mismo profesional
- mismo dia

No importa si los servicios son distintos. Un profesional no puede tener dos turnos superpuestos.

## Asignacion automatica

Cuando el cliente elige "Cualquiera disponible":

1. El frontend muestra horarios disponibles combinando todos los profesionales.
2. Al confirmar, envia `professionalId: null`.
3. El backend busca profesionales con bloque compatible para ese dia y horario.
4. Filtra los que no esten alineados al intervalo del bloque.
5. Filtra los que tengan solapamiento.
6. Asigna el primer profesional disponible ordenado por nombre.

La asignacion final siempre la decide el backend.

## Validaciones backend actuales

El backend valida:

- servicio existente
- campos obligatorios
- horario `HH:MM`
- rango horario valido
- `professionalId` entero positivo si viene informado
- existencia de bloque compatible para profesional especifico
- alineacion del horario con `interval_minutes`
- que el servicio completo entre dentro del bloque
- ausencia de solapamientos
- conflictos de unicidad por `professional_id + day + time`

Codigos esperados:

- `201`: reserva creada
- `400`: datos invalidos o incompletos
- `404`: reserva a cancelar no encontrada
- `409`: horario ocupado o conflicto de reserva
- `500`: error inesperado

## Migraciones actuales

El backend realiza migraciones simples al iniciar:

- Crea tablas base si no existen.
- Crea `professional_schedules` si no existe.
- Si `reservations` no tiene `professional_id`, descarta esa tabla vieja por incompatibilidad.
- Si `reservations` tenia la restriccion antigua que incluia `service_id`, reconstruye la tabla.
- Si `duration_minutes` existe pero no es `NOT NULL`, reconstruye la tabla para dejarla como `INTEGER NOT NULL DEFAULT 30`.
- Al reconstruir reservas, rellena `duration_minutes` con:
  - el valor existente si esta presente
  - la duracion actual del servicio si falta
  - `30` como ultimo fallback

## Riesgos conocidos

### Sin autenticacion admin

El panel admin no tiene login porque se pidio explicitamente no agregarlo todavia. Cualquier persona que acceda a la app local puede cancelar o borrar reservas.

### Borrado total expuesto

`DELETE /api/reservations` borra todas las reservas. Es util para pruebas, pero riesgoso si la app pasa a un entorno real.

### Dias como texto fijo

Los dias son strings como `Lunes 27` o `Sabado 1`, no fechas reales ISO. Esto alcanza para el prototipo, pero limita ordenamiento, calendario real, meses y zonas horarias.

### Horarios sin zona horaria ni fecha real

La app trabaja con horas `HH:MM` y dias textuales. No hay modelo de fecha/hora completo.

### Migraciones simples en codigo

Las migraciones estan dentro de `server.js`. Funcionan para el estado actual, pero si el modelo crece conviene separar migraciones versionadas.

### Sin tests automatizados

Se hicieron verificaciones manuales/API durante el desarrollo, pero no hay suite de tests automatizada para reglas de disponibilidad, solapamiento y migraciones.

### Servicios sin gestion admin

Los servicios viven en SQLite, pero se siembran desde `servicesSeed`. No existe pantalla ni endpoint admin para crear, editar o borrar servicios.

### Profesionales y agendas sin gestion admin

Los profesionales y bloques se guardan en SQLite, pero no hay UI ni endpoints admin para editarlos. Los datos iniciales vienen de semillas.

### Concurrencia limitada por SQLite local

`BEGIN IMMEDIATE TRANSACTION` reduce condiciones de carrera para reservas simultaneas. Para una app local/simple esta bien, pero si se expone con alto trafico habria que revisar manejo de busy timeouts, reintentos y despliegue.

## Proximos pasos sugeridos

1. Agregar tests automatizados de backend para:
   - horarios invalidos
   - alineacion con intervalo
   - solapamientos
   - duraciones guardadas
   - asignacion automatica
   - migraciones de `reservations`

2. Reemplazar dias textuales por fechas reales:
   - `YYYY-MM-DD` en base de datos
   - labels amigables solo en frontend

3. Crear administracion simple de datos base:
   - servicios
   - profesionales
   - bloques horarios

4. Proteger el panel admin:
   - login basico
   - o al menos una clave local simple para prototipo

5. Quitar o proteger el borrado masivo de reservas antes de usar con clientes reales.

6. Separar migraciones en archivos/versiones si el proyecto sigue creciendo.

7. Agregar validaciones de datos de agenda:
   - `start_time < end_time`
   - `interval_minutes > 0`
   - formato horario estricto en bloques
   - evitar bloques duplicados o incoherentes.

