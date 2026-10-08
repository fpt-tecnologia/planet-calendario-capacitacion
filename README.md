# Planet · Calendario de capacitación

Aplicación web para gestionar la capacitación de Planet Fitness: calendario central, accesos por rol, propuestas de Regionales y dashboard acumulado para Dirección.

- **Frontend:** HTML, CSS y JavaScript sin compilación, publicado con GitHub Pages.
- **Datos y permisos:** Firebase (Authentication + Cloud Firestore). Los permisos y las validaciones críticas se aplican en el servidor con `firestore.rules`.
- **Cierre mensual programado:** GitHub Actions, el día 1 de cada mes a las 00:15 de Ciudad de México.

## Roles

| Rol | Cómo se obtiene | Puede |
|---|---|---|
| Administradora | Su correo está en `config/roles.admins` (inicial: `jair@fpt.com.mx`) | Crear, editar y duplicar capacitaciones; cambiar estados del mes en curso; ver historial y dashboard; configurar descansos, áreas y accesos; confirmar o rechazar propuestas; importar y exportar |
| Gerentes (consulta) | Correo de un dominio autorizado o en la lista de lectores | Ver calendario, agenda, Bootcamps y detalles; filtrar; exportar el mes a Excel |
| Regional | Correo registrado por la administradora con sus regiones | Proponer capacitaciones (nombre, día, región) sólo para sus regiones y ver el estado de sus propuestas |

Todas las personas entran con un **enlace de acceso enviado a su correo** (sin contraseñas). Compartir la dirección de la app no da permisos.

## Puesta en marcha (una sola vez, ~20 minutos)

### 1. Crear el proyecto Firebase
1. Entra a <https://console.firebase.google.com> → **Agregar proyecto** (puede ser el plan gratuito Spark).
2. **Build → Firestore Database → Crear base de datos** en modo producción, ubicación `nam5` o `us-central`.
3. **Build → Authentication → Comenzar → Método de acceso:** habilita **Correo electrónico/contraseña** y activa **Vínculo de correo electrónico (acceso sin contraseña)**. Opcional: habilita **Google**.
4. **Authentication → Configuración → Dominios autorizados:** agrega `fpt-tecnologia.github.io` (o tu dominio propio).
5. **Configuración del proyecto → General → Tus apps → Web (`</>`)**: registra la app y copia el objeto `firebaseConfig`.

### 2. Configurar el repositorio
1. Pega los valores de `firebaseConfig` en [`js/config.js`](js/config.js).
2. Si la administradora inicial no es `jair@fpt.com.mx`, cámbiala en `js/config.js` (`adminInicial`) **y** en `firestore.rules` (`bootstrapAdmin()`).
3. Opcional: en `dominiosIniciales` pon los dominios de correo de los Gerentes (también se configuran desde la app).

### 3. Secretos y variables de GitHub (Settings → Secrets and variables → Actions)
- **Variable** `FIREBASE_PROJECT_ID`: el ID del proyecto Firebase.
- **Secreto** `FIREBASE_SERVICE_ACCOUNT`: en Firebase → Configuración del proyecto → **Cuentas de servicio → Generar nueva clave privada**; pega el JSON completo. Lo usan el despliegue de reglas y el cierre mensual. Nunca lo subas al repositorio.

### 4. Activar GitHub Pages
Settings → Pages → Source: **GitHub Actions**. Cada push a `main` publica la app en `https://fpt-tecnologia.github.io/<repositorio>/`.

### 5. Desplegar las reglas
Se despliegan solas al cambiar `firestore.rules` en `main` (workflow *Desplegar reglas de Firestore*). La primera vez ejecútalo manualmente desde la pestaña **Actions → Desplegar reglas de Firestore → Run workflow**.

### 6. Primer ingreso
Abre la app, escribe el correo de la administradora y abre el enlace que llega. En el primer ingreso se crea la configuración de roles.

## Uso

- **Administrar el calendario:** “+ Nueva capacitación” o el “+” de cada día. Abre una actividad para editarla, duplicarla o cambiar su estado.
- **Duplicar:** abre el formulario con los datos copiados y la fecha vacía; la copia se guarda como registro nuevo sólo al pulsar “Guardar copia”.
- **Habilitar Regionales:** Configuración → Accesos de Regionales → correo + regiones → “Habilitar Regional”. Envíales `https://…/#regional`.
- **Confirmar propuestas:** pestaña Propuestas. Cada confirmación crea una sola capacitación “Por confirmar” (id `p-<propuesta>`), aunque se pulse dos veces.
- **Gerentes:** Configuración → Acceso de Gerentes → agrega el dominio de correo (o correos individuales) y comparte el enlace de la app.
- **Importar información inicial:** Configuración → Importar (Excel o CSV). Hay vista previa; los duplicados se omiten y lo incompleto, contradictorio o en feriado se marca “Revisar”.

## Reglas de negocio implementadas en el servidor (`firestore.rules`)

- Sólo la administradora escribe y elimina capacitaciones (botón “Eliminar” en el detalle, con confirmación y registro en el historial). El historial no se puede borrar.
- Gerentes y Regionales no leen notas internas, historial, roles ni propuestas ajenas.
- No se crean capacitaciones ni propuestas en días bloqueados (`config/bloqueos`, generado por la app con el art. 74 LFT y los descansos configurados). Las importaciones en feriado se conservan para revisión.
- Bootcamp exige club que se aperturará.
- El estado sólo cambia en capacitaciones del mes en curso, salvo el cierre automático de meses anteriores (nunca sobre canceladas).
- Regionales: sólo sus regiones autorizadas, fecha desde hoy (hora de Ciudad de México), estado inicial “Pendiente”; no pueden confirmar.
- Una propuesta decidida no cambia de estado.

## Feriados (art. 74, Ley Federal del Trabajo)

1 de enero; primer lunes de febrero; tercer lunes de marzo; 1 de mayo; 16 de septiembre; tercer lunes de noviembre; 1 de octubre cada seis años por transmisión del Poder Ejecutivo Federal (2030, 2036…); 25 de diciembre; y los que determinen las leyes electorales (se agregan desde Configuración). Semana Santa y vacaciones escolares no se bloquean. Texto verificado con la última reforma publicada el 14-05-2026.

## Cierre mensual

- `scripts/cierre-mensual.mjs` marca como “Realizada” las capacitaciones de meses terminados que no estén canceladas, con `cierreAuto` y un movimiento `auto-<id>-<mes>` en el historial (idempotente).
- Corre el día 1 a las 00:15 (CDMX) con GitHub Actions y también al abrir la app como administradora, por si el proceso programado no se ejecutó.
- Los reportes distinguen “cierre automático” de “validación manual”.

## Desarrollo

```bash
npm install
npm test            # lógica: feriados, indicadores, cierre, validaciones
npm run test:rules  # reglas con el emulador de Firestore (requiere Java 11+)
npm run serve       # http://localhost:5173
```

## Estructura

```
index.html                  Página
css/styles.css              Estilos (blanco, morado y amarillo; modo oscuro)
js/config.js                Configuración de Firebase y administradora inicial
js/lib.js                   Lógica pura (feriados, indicadores, dashboard, importación)
js/app.js                   Interfaz, roles y acceso a datos
firestore.rules             Permisos y validaciones del servidor
scripts/cierre-mensual.mjs  Cierre mensual programado
tests/                      Pruebas de lógica y de reglas
.github/workflows/          Pruebas, GitHub Pages, reglas y cierre mensual
```
