# Cabina — Memoria del proyecto

> Estudio virtual privado para escuchar el DAW en alta calidad, hablar y verse con colegas.
> Alternativa casera, gratuita o casi, a apps como Muse.
>
> Autor: Fran · Versión 0.1 · Octubre de 2026

---

## Índice

1. [Objetivo](#1-objetivo)
2. [Qué incluye](#2-qué-incluye)
3. [Arquitectura](#3-arquitectura)
4. [La web](#4-la-web)
5. [Los plugins](#5-los-plugins)
6. [Protocolo entre la web y los plugins](#6-protocolo-entre-la-web-y-los-plugins)
7. [Calidad de audio y latencia](#7-calidad-de-audio-y-latencia)
8. [Puesta en marcha](#8-puesta-en-marcha)
9. [Uso en sesión](#9-uso-en-sesión)
10. [Compilar los plugins](#10-compilar-los-plugins)
11. [Estructura de carpetas](#11-estructura-de-carpetas)
12. [Costes](#12-costes)
13. [Seguridad y privacidad](#13-seguridad-y-privacidad)
14. [Limitaciones conocidas](#14-limitaciones-conocidas)
15. [Pruebas realizadas](#15-pruebas-realizadas)
16. [Hoja de ruta](#16-hoja-de-ruta)
17. [Solución de problemas](#17-solución-de-problemas)
18. [Licencias](#18-licencias)

---

## 1. Objetivo

Trabajar mezclas y producciones en remoto con colegas (la mayoría en Mac, alguno en Windows) sin pagar suscripciones:

- Escuchar el DAW de otra persona **en estéreo y con calidad alta**, no con el audio comprimido de una videollamada.
- Hablar y verse a la vez.
- Poder **grabar en tu DAW** lo que suena en el DAW del otro.
- Coste cercano a cero y sin servidores propios que mantener.

Lo que **no** pretende: tocar en sincronía en tiempo real. La latencia de internet lo impide en cualquier app de este tipo, Muse incluida.

## 2. Qué incluye

| Pieza | Qué hace | Dónde |
|---|---|---|
| **Web Cabina** | Sala por enlace con vídeo, voz, chat, envío del DAW en alta calidad, medidores, grabación WAV | `web/index.html` |
| **Cabina Send** (VST3/AU) | Va en el máster. Deja pasar el audio intacto y lo entrega a la web, sin BlackHole ni VB-Cable | `plugin/` |
| **Cabina Retorno** (VST3/AU) | Va en una pista. Recibe de la web el DAW de un colega para escucharlo o grabarlo | `plugin/` |
| **Compilación automática** | GitHub compila los plugins para Mac y Windows | `.github/workflows/compilar.yml` |

Los plugins son **opcionales**: la web funciona sola con un cable de audio virtual.

## 3. Arquitectura

```
   TU ORDENADOR                                           ORDENADOR DE TU COLEGA
 ┌──────────────────────────────┐                       ┌──────────────────────────────┐
 │ DAW                          │                       │ DAW                          │
 │  máster ─► [Cabina Send] ────┼─ ws://127.0.0.1:47800 │                              │
 │                              │        │              │  pista ◄─ [Cabina Retorno] ◄─┼─ ws://127.0.0.1:4780x
 │                              │        ▼              │                              │        ▲
 │ Chrome: web Cabina           │                       │ Chrome: web Cabina           │        │
 │  · micro + cámara ───────────┼═══ WebRTC (P2P) ═════►│  · vídeo y voz               │        │
 │  · DAW (Opus 510 kbps) ──────┼═══ WebRTC (P2P) ═════►│  · DAW entrante ─────────────┼────────┘
 └──────────────────────────────┘                       └──────────────────────────────┘
                 │                                                    │
                 └──────── PeerJS (solo para encontrarse) ────────────┘
```

- **El audio y el vídeo van directos de ordenador a ordenador** (WebRTC peer-to-peer). No pasan por ningún servidor, salvo cuando un router no deja conectar directamente; entonces se usa un servidor TURN de relevo.
- **PeerJS** solo hace de "centralita" para que los navegadores se encuentren. Se usa su servidor público gratuito.
- **Los plugins hablan con la web por localhost** (WebSocket en `127.0.0.1`). No abren nada hacia internet.

## 4. La web

Un único archivo HTML (más el icono `icono.png`, el logo de 1st), sin build. Dependencias desde CDN: PeerJS y, solo si se elige *Ruido: fuerte*, la reducción de ruido RNNoise (`@sapphi-red/web-noise-suppressor@0.4.1`, MIT, desde jsDelivr).

### Sala

- La sala es el parámetro `?sala=nombre` de la URL. "Copiar enlace" lo pone en el portapapeles.
- El primero en entrar reserva el ID `cabina-v1-<sala>` en PeerJS y hace de **anfitrión**. Los demás se conectan a él, reciben la lista de quién hay y se conectan con todos (**malla**).
- *Entrar en la sala* se desactiva al pulsarlo (`S.entering`). Pedir micro y cámara tarda un momento, y hasta el 22-10-2026 un segundo clic metía a la misma persona dos veces: los demás la veían duplicada y ella se veía dos veces.
- Sin nombre se entra como "Anónimo", pero no se guarda como nombre para la próxima vez.
- **Si se pierde el anfitrión** (se va, cierra la pestaña o se le corta la red), los invitados lo vuelven a buscar cada 2 s (`lostHost`). Si ya no está, el primero de los que quedan, por orden de ID, reserva el ID de la sala y pasa a ser anfitrión; los demás se conectan a él y vuelven a verse todos. Una conexión que no se abre en 8 s se descarta y se reintenta (pasa si el servidor aún no sabe que el anfitrión se ha ido).
  - Hasta el 26-10-2026 nadie se reconectaba: tras un corte, cada uno se quedaba solo en su sala creyendo que se había ido el otro, y quien entraba después acababa en otra sala distinta.
  - Probado con 4 navegadores: un corte de red, la anfitriona que sale con *Salir*, alguien que entra después y la anfitriona que cierra la pestaña de golpe. En todos los casos se vuelven a ver en 6–15 s.
- **Salir** avisa a los demás (`bye`) para que te quiten al momento y vuelve a la portada. En la Cabina servida por el plugin (Safari), si el DAW ya está cerrado la portada no cargaría y Safari daba error: entonces se vuelve a la web publicada (`goHome`).
- El nombre de cada persona llega en su saludo (`hello`) o en los datos de la conexión que abre ella. Hasta el 26-10-2026, al conectarte tú a alguien, se le ponía tu nombre hasta que llegaba su saludo.
- **Presencia**: cada participante manda una señal de vida (`ping`) cada 3 s por el canal de datos. Quien lleve 15 s sin darla (conexión caída, móvil bloqueado) sale de la sala para los demás.
- **Echar**: el anfitrión ve un botón *Echar* en cada vídeo. Manda `kick` a esa persona (su web sale de la sala) y `kicked` al resto, que la quitan y no vuelven a conectar con ella. Solo se obedecen si vienen del ID del anfitrión. Si la persona vuelve a entrar con el enlace, puede hacerlo (no es un bloqueo permanente).

### Conexiones por cada pareja de personas

| Canal | Contenido | Ajustes |
|---|---|---|
| Datos | nombres, chat, cámara on/off, aviso de fin de emisión | fiable |
| Llamada "talk" | micro + cámara | supresión de ruido activada; cancelación de eco activada salvo en Safari (ver §14) |
| Llamada "daw" | audio del DAW (modo Opus) | Opus estéreo 510 kbps, FEC, sin DTX, sin procesado de voz |
| Datos "pcm" | audio del DAW (modo sin pérdidas) | PCM 16 bit con dither o 24 bit, bloques de 20 ms, canal fiable y ordenado |
| Datos "file" | un archivo del chat (una conexión por archivo y persona) | fiable y ordenado, trozos de 64 KB |
| Llamada "screen" | pantalla compartida (solo vídeo) | hasta 30 fps, 4 Mbps, prioriza nitidez (`contentHint = detail`, `maintain-resolution`) |

### Funciones

- Selector de cámara, micro, entrada del DAW y salida de escucha. Se recuerdan en el navegador de cada persona (`localStorage`, clave `cabina-prefs`). Si ya dio permiso de micro y cámara, se rellenan solos al abrir la página.
- **Dispositivos que aparecen o desaparecen** (auriculares, interfaces, la cámara del iPhone): si el micro o la cámara que usas desaparecen, o usas el micro del sistema y el sistema cambia a otro, la página cambia sola sin cortar a los demás y avisa (`followDevices`, al cambiar la lista de dispositivos o al terminarse la pista). Lo mismo con la salida de escucha. Hasta el 26-10-2026 la pista se quedaba muerta y los demás dejaban de oírte, y el desplegable mostraba otro dispositivo sin haberlo cambiado de verdad. Cambiar de micro a mano ya funcionaba (probado: el otro sigue oyendo con los tres micros de prueba y con la reducción de ruido fuerte).
- **Calidad de emisión**: Opus 510 kbps (por defecto) o sin pérdidas a 16 o 24 bit (ver §7).
- Aviso la primera vez que se abre la web con los enlaces de descarga de los plugins (botón *Plugin de transmisión* para volver a verlo).
- Medidores de pico L/R (−60 a 0 dBFS) del DAW propio y de cada DAW entrante.
- Por cada DAW entrante: volumen, silenciar, kbps reales, estéreo/mono y paquetes perdidos.
- **Grabar**: graba lo que llega en WAV estéreo de 24 bits a 48 kHz y lo descarga.
- **Mandar a mi DAW**: envía ese audio a un plugin Cabina Retorno.
- Chat con hora, útil para notas tipo "1:42 baja la voz 1 dB".
- **Filtro de perrito** (botón *Perrito* en tu tarjeta):
  - Orejas, nariz y lengua (al abrir la boca) que siguen cada cara. El dibujo es propio, no el de Snapchat, que tiene derechos.
  - Detecta las caras con MediaPipe Face Landmarker (`@mediapipe/tasks-vision@0.10.21` desde jsDelivr, modelo de Google Storage, 3,7 MB, se descarga al activarlo).
  - Se envía el vídeo ya con el filtro (canvas → `captureStream`), así que los demás lo ven igual. El espejo lo sigue poniendo cada pantalla.
  - En Chrome y Edge lee los fotogramas con `MediaStreamTrackProcessor`, que sigue funcionando con la pestaña en segundo plano; en Safari, con `requestVideoFrameCallback`.
  - Detecta en uno de cada dos fotogramas. Se recuerda en `cabina-prefs` y se vuelve a montar al cambiar de cámara.
- **Easter egg**: al pulsar la bola azul (arriba a la izquierda, también en la pantalla de entrada) suena un *hitmarker* y la bola rebota.
  - Sonido: "Hitmarker Sound Effect", de aruscio28 en Freesound ([freesound.org/s/322640](https://freesound.org/people/aruscio28/sounds/322640/)), **CC0** (dominio público): `web/hitmarker.mp3`.
  - Se carga con la ruta completa (`window.CABINA_WEB`) para que también suene en la Cabina servida por el plugin.
  - Solo suena para quien la pulsa.
  - Antes era un "uhh!" sintetizado al estilo del de Roblox; el original no se podía usar por derechos.
- **Archivos por el chat** (clip o arrastrando sobre el chat): van directos de ordenador a ordenador, sin servidor y **sin coste**. Límite de **1 GB por archivo**, porque quien recibe lo guarda en memoria hasta descargarlo.
  - Cada archivo sale como una **tarjeta**, como en Muse o Discord: recuadro con borde azul, la extensión (WAV, FLP...), el nombre, el tamaño y el estado, con una barra de progreso abajo. Cuando está entero, se pulsa la tarjeta para descargarlo (quien lo envía, desde el principio). Los **audios** llevan un reproductor para escucharlos ahí mismo y las **imágenes** se ven en pequeño. Si falla, el borde se pone rojo.
  - El tipo de archivo que dice el emisor solo se usa si tiene forma de tipo MIME; si no, se guarda como binario.
  - Se ve el progreso; el que envía ve "Enviado a N personas". Solo llega a quienes estén en la sala en ese momento. Quien recibe cierra la conexión al tenerlo entero, y así sabe el emisor que llegó. El emisor no llena la memoria más rápido de lo que sube (espera si hay más de 8 MB pendientes). Probado: 12 MB llegan idénticos en 3 s en local. Por internet, la velocidad es la de la subida de quien envía; si la conexión va por el servidor de relevo (TURN), puede ser bastante más lenta.
- **Tarjeta de cada participante**:
  - **Estado de la conexión** junto al nombre: punto verde con la latencia de ida y vuelta (ámbar si pasa de 250 ms), ámbar mientras conecta, reconecta o lleva más de 6 s sin dar señales, y rojo sin conexión. Al pasar el ratón dice si la conexión es directa o por el servidor de relevo. Es la conexión **con cada persona**, así que si estás solo no hay ninguno. Tu propia tarjeta lleva otro punto: verde si estás conectado al servidor que reúne la sala, ámbar si está reconectando.
  - **Brillo azul en el borde** mientras habla (voz por encima de −50 dBFS, con 350 ms de margen). También en tu propia tarjeta; con el micro silenciado no se enciende.
  - **Volumen de su voz** (deslizador arriba a la derecha, aparece al pasar el ratón): es tu mezcla, solo cambia lo que oyes tú. Se recuerda por nombre (`localStorage`, clave `cabina-vols`).
- **Espejo**: por defecto te ves en espejo, como en FaceTime, **y los demás también te ven así**, para que todos te vean igual que tú. El vídeo que se envía no se toca: quien emite dice en el `hello` (y con el mensaje `mirror`) si va en espejo, y cada uno lo gira en su pantalla. Botón *Espejo* en tu tarjeta para quitarlo (por ejemplo, para enseñar algo con texto). Se recuerda en `cabina-prefs`.
- **Reducción de ruido del micro** (selector *Ruido* arriba):
  - *Normal*: la del navegador.
  - *Fuerte*: RNNoise, una red neuronal que quita teclado, ventiladores o ruido de calle. El micro pasa por un `AudioWorklet` y se envía ya limpio. Necesita la página a 48 kHz, así que en Safari aparece desactivada.
  - *Sin filtro*.
  
  Se recuerda en `cabina-prefs`.
- **Emisión automática con el plugin**:
  - Al pulsar *Emitir DAW* (o al entrar con el plugin elegido), si Cabina Send no está abierto, la web lo espera (botón *Cancelar*) y empieza sola en cuanto aparece.
  - Si el plugin se cierra mientras se emite (al cerrar y abrir el proyecto, por ejemplo), la emisión sigue sola cuando vuelve. La pista que reciben los demás es la misma, así que la llamada no se corta.
  - Esa pausa no cuenta como corte y no hace crecer el colchón (mensaje `idle` al `AudioWorklet`).
  - Igual en Safari, siempre que Cabina se haya abierto desde el plugin (§6).
- **Compartir pantalla** (botón *Pantalla*): el navegador deja elegir una ventana (el DAW) o la pantalla entera. Los demás la ven en grande encima de las cámaras, que pasan a tamaño pequeño y **centradas** debajo, con botón de *Pantalla completa*. Va sin audio, porque el sonido ya va por el DAW. Quien entra a mitad también la recibe. Si comparten varios a la vez, se ve la última. Al parar, se manda `screen-stop` con un número de generación para no cerrar por error una pantalla compartida después.

## 5. Los plugins

Hechos con **JUCE 8** (C++17). Un mismo código fuente genera los dos plugins; la constante `CABINA_RETURN` decide cuál.

### Cabina Send

- Efecto estéreo o mono. **No modifica el audio**: lo deja pasar tal cual.
- En cada bloque copia las muestras a una cola sin bloqueos (`juce::AbstractFifo`, unos 2,7 s), y solo cuando hay alguien conectado.
- Un hilo aparte vacía la cola cada ~5 ms y envía bloques de 1024 frames por WebSocket.
- Escucha solo en `127.0.0.1:47800`. Solo puede haber un Send abierto a la vez.

### Cabina Retorno

- Efecto que **sustituye** el audio de la pista por lo que llega de la web.
- Cada instancia coge el primer puerto libre entre `47801` y `47808`, así que puedes tener hasta 8 retornos, uno por colega.
- Mantiene un **colchón adaptable**, que empieza en 60 ms. Si se vacía, saca silencio, vuelve a llenarlo y entra con un fundido de 5 ms. Si el corte fue breve (menos de 1 s: el navegador o la red se atascaron), el colchón crece un 50 %, hasta 0,5 s. Si la emisión simplemente se paró, no crece. La ventana del plugin muestra el colchón actual. Si se acumula más de 6 veces el colchón, salta hacia delante para no ir con retraso.
- Avisa a la web del nombre de la pista (en los DAW que lo informan, como Reaper) para que aparezca en el selector.

### Servidor WebSocket propio

`WebSocketServer.cpp` es una implementación mínima del estándar RFC 6455, sin librerías externas:

- Handshake con SHA-1 + Base64.
- Un hilo para aceptar conexiones y uno por cliente para leer.
- Soporta mensajes binarios, texto, ping/pong, fragmentación y cierre.
- Límite de 8 MB por mensaje.
- Tras servir la página de carga (§6), cierra con calma en Mac (`shutdown` de escritura y espera a que Safari cierre). Cerrar de golpe podía cortar la página a medias.

### Interfaz

Ventana de 400×190 con estado (esperando / conectado / emitiendo / recibiendo), origen de la conexión, puerto y medidores L/R.

## 6. Protocolo entre la web y los plugins

Conexión: `ws://127.0.0.1:<puerto>`.

1. Al conectar, el plugin envía un **hello** en JSON:

   ```json
   { "type": "hello", "role": "send", "sr": 48000, "ch": 2, "port": 47800, "name": "Master" }
   ```

   Lo reenvía si cambia el sample rate o el nombre de la pista.

2. Después, **mensajes binarios**: `float32` little-endian, estéreo intercalado (`L R L R …`).
   - **Send → web**: al sample rate del DAW. La web remuestrea a 48 kHz.
   - **web → Retorno**: la web ya lo manda remuestreado al sample rate del DAW.

**Safari: Cabina servida por el propio plugin.** Safari bloquea `ws://127.0.0.1` desde una web `https` porque lo trata como contenido mixto (Chrome y Edge lo permiten). Sin embargo, una página servida desde `http://127.0.0.1` sí puede conectarse a los plugins, y además cuenta como segura, así que da acceso a micro y cámara. Por eso:

- Los plugins sirven en la raíz, `http://127.0.0.1:<puerto>/`, una página mínima que descarga la web publicada con `fetch` y la pone en su lugar con `document.write`. GitHub Pages responde con `Access-Control-Allow-Origin: *`, así que se puede descargar.
  - La dirección de la web se fija al compilar: `CABINA_WEB_URL`, por defecto `https://1stpleiss.github.io/cabina/`.
  - Los cambios de la web llegan sin recompilar el plugin.
  - La página deja la dirección pública en `window.CABINA_WEB`. La web la usa para *Copiar enlace*, que siempre da el enlace público, y para el icono.
- En Safari, desde la web `https`, al usar el plugin (*Emitir DAW* o *Buscar retornos*), primero **se prueba a conectar directamente** (`localAllowed()`):
  - WebKit quitó el bloqueo de las direcciones locales el 4-9-2026 ([PR 72974](https://github.com/WebKit/WebKit/pull/72974), [bug 171934](https://bugs.webkit.org/show_bug.cgi?id=171934)). No consta en qué versión de Safari llega; Safari 27.0.1 seguramente aún no lo trae.
  - Si ya lo permite, se usa directamente y no se cambia de página.
  - Si no, sale un aviso con el botón **Abrir Cabina desde el plugin**. Lleva, en la misma pestaña, a `http://127.0.0.1:47800/?sala=…&nombre=…&daw=plugin&entrar=1`: la misma sala, con el nombre y el plugin ya elegidos, y **entrando sola en la sala** (`entrar`). La primera vez, Safari pedirá permiso de micro y cámara para esa dirección.
- Esa copia solo existe mientras el plugin está abierto. Su `localStorage` es aparte (otro origen), así que las preferencias no se comparten con la web publicada.
- Si solo hay un Cabina Retorno abierto, la dirección es `http://127.0.0.1:47801/`.

> Hasta el 23-10-2026 se usaba una **ventanita puente**: el plugin servía `/puente`, la web la abría en un popup y le pasaba los mensajes con `postMessage`. Daba problemas:
> - Se abría sola al entrar con el plugin elegido.
> - Si el plugin no estaba escuchando, Safari mostraba *"no ha podido conectarse al servidor"*.
> - Abrir la ventana gastaba el clic que Safari necesita para arrancar el audio.
>
> Se quitó.

Detalles del servidor de los plugins:

- **Safari prueba antes `https://`** al abrir `http://127.0.0.1:<puerto>`. Hasta el 21-10-2026, el plugin se quedaba esperando sin responder a esa conexión TLS. Ahora cierra al instante cualquier conexión cuyo primer byte no sea una letra mayúscula (el inicio de `GET`), y Safari vuelve a `http`. También cierra las conexiones que no envían nada en 5 s.
- **Si el puerto deja de aceptar conexiones** (20 fallos seguidos de `accept`), el servidor lo cierra y lo vuelve a abrir. Antes se quedaba esperando para siempre, con el plugin cargado pero sin escuchar.
- Al pulsar *Entrar* no se espera más de 1 s a `AudioContext.resume()`: en Safari, sin un clic reciente, no termina nunca. Si el audio sigue parado, arranca con el siguiente clic.

Todo el remuestreo se hace en la web, en un `AudioWorklet`, para que el plugin sea más simple:

- **Interpolación sinc con ventana de Kaiser** (64 puntos, tabla de 512 fases; más puntos y corte más bajo al bajar de sample rate). Respuesta plana hasta 20 kHz; ruido y distorsión por debajo de −73 dB a 44,1, 48 y 96 kHz.
- **Corrección de deriva de reloj** muy lenta (nivel del colchón suavizado con constante de ~2 s, máximo ±500 ppm).
- **Colchón adaptable** en `cabina-in`: empieza en 80 ms con Cabina Send y en 250 ms en modo sin pérdidas, y crece un 50 % con cada corte, hasta 0,5 s. Tras un corte entra con un fundido de 5 ms. Si el plugin repite el `hello` con el mismo sample rate (lo hace al cambiar el nombre de la pista), no se reinicia lo aprendido. La web del emisor muestra junto al plugin el colchón y los cortes.
- El `AudioContext` de la página usa la misma salida que *Escuchar* (`setSinkId`). Si fueran por dispositivos distintos, sus relojes derivarían y saldrían chasquidos.

> **Por qué colchones adaptables (21-10-2026).** El audio del plugin llega a la web por el hilo principal de la página. Mientras se trabaja en el DAW, el navegador está en segundo plano y macOS le da menos prioridad, así que ese hilo se atasca a ratos. Con colchones fijos de 60 ms, en el emisor y en el Retorno, cada atasco de más de 60 ms era un corte, **con cualquier calidad de emisión**. Medido con atascos simulados de 30–90 ms por segundo: antes había 3–6 cortes cada 15 s; ahora, 1 al principio y ninguno después.

> Hasta la v0.1 se usaba interpolación lineal con corrección rápida de ±0,3 %. Como la posición de lectura nunca caía exactamente en una muestra, la interpolación actuaba como un filtro de agudos que cambiaba sin parar: los agudos oscilaban hasta 6 dB y sonaba "desfasado", como un phaser. Pasaba con cualquier sample rate, también a 48 kHz.

## 7. Calidad de audio y latencia

| Tramo | Formato | Notas |
|---|---|---|
| DAW → plugin → web | float32 sin pérdidas | localhost, ~3 MB/s |
| Web → web (internet), modo Opus | **Opus estéreo 510 kbps** | el máximo que permite WebRTC; transparente para escuchas de mezcla |
| Web → web (internet), modo sin pérdidas | **PCM 16 bit (1,5 Mbps) o 24 bit (2,3 Mbps)** por oyente | canal de datos fiable; colchón de 250 ms en el receptor |
| Web → Retorno | float32 sin pérdidas | localhost |

**Latencia orientativa** de extremo a extremo (DAW de A → oídos de B): 300–500 ms según la red con Opus (el búfer de WebRTC del DAW entrante se pide de 300 ms para que estire y encoja menos el audio); algo menos en modo sin pérdidas. Los colchones adaptables pueden sumar hasta ~0,4 s más si el ordenador va justo.

**Modo sin pérdidas**: un `AudioWorklet` (`cabina-cap`) corta el DAW en bloques de 20 ms y los pasa a entero (16 bit con dither TPDF, o 24 bit). Se envían por una conexión de datos de PeerJS (`serialization: 'raw'`, fiable y ordenada). El receptor los vuelve a float y los mete en el mismo `cabina-in` que usa el plugin, con un colchón de 250 ms. Si la subida no da abasto, se descartan bloques en lugar de acumular retraso y sale un aviso. En malla, la subida se multiplica por el número de oyentes: con 3 oyentes a 24 bit, unos 7 Mbps. Sirve para revisar mezclas y tomas, no para tocar a la vez.

Para valorar una mezcla con criterio, pide al otro un bounce WAV. Cabina es para trabajar en directo, no para la escucha final.

## 8. Puesta en marcha

### 8.1 Publicar la web (gratis, una vez)

Opción rápida con **Netlify Drop**:

1. Ve a `app.netlify.com/drop`.
2. Arrastra la carpeta `web/`.
3. Te da una URL `https://…netlify.app`. Esa es la de todos.

Alternativa: **GitHub Pages**. Sube el repositorio y en *Settings → Pages → Source* elige **GitHub Actions**. El workflow `.github/workflows/web.yml` publica la carpeta `web/` en `https://<usuario>.github.io/<repositorio>/` cada vez que cambia.

> La web **tiene que ir por https**; si no, el navegador no da acceso a micro y cámara.

Para probar en local desde VS Code: extensión *Live Server* → clic derecho en `web/index.html` → *Open with Live Server*. `localhost` cuenta como seguro.

### 8.2 Cada colega

- **Solo escuchar**: abrir el enlace en Chrome o Edge. Nada más.
- **Emitir su DAW**, elige una de dos:
  - **Plugin Cabina Send** en el máster (recomendado).
  - **Cable virtual**:
    - **Mac**: instalar BlackHole 2ch. En *Configuración de Audio MIDI*, crear un *Dispositivo de salida múltiple* con la interfaz + BlackHole y ponerlo como salida del DAW.
    - **Windows**: instalar VB-Cable y sacar el DAW por *CABLE Input*. Para oírse: *Sonido → Grabación → CABLE Output → Propiedades → Escuchar* hacia la interfaz.
- **Grabar en el DAW lo que llega**: plugin **Cabina Retorno** en una pista.

### 8.3 Instalar los plugins

Lo más fácil: los **instaladores** de la release `plugins` del repositorio. La web los enlaza en su aviso inicial y en el botón *Plugins*.

- **Mac**: `Cabina-Mac.pkg` instala VST3 y AU en `/Library/Audio/Plug-Ins/`. Mientras no esté firmado con una cuenta de desarrollador de Apple, macOS pedirá ir a *Ajustes del Sistema → Privacidad y seguridad → Abrir igualmente* con cada versión nueva (§10.1 para firmarlo). Al instalar con `.pkg` no hace falta quitar la cuarentena.
- **Windows**: `Cabina-Windows.exe` instala los VST3 en `C:\Program Files\Common Files\VST3\`. Sin firmar: *Más información → Ejecutar de todas formas*.
- También hay `.zip` con los plugins sueltos para instalarlos a mano:

| Sistema | Formato | Carpeta |
|---|---|---|
| Mac | VST3 | `~/Library/Audio/Plug-Ins/VST3/` |
| Mac | AU | `~/Library/Audio/Plug-Ins/Components/` |
| Windows | VST3 | `C:\Program Files\Common Files\VST3\` |

En Mac, si instalas a mano desde el `.zip`, quita la cuarentena:

```bash
xattr -dr com.apple.quarantine ~/Library/Audio/Plug-Ins/VST3/Cabina*.vst3 ~/Library/Audio/Plug-Ins/Components/Cabina*.component
```

Después, en Reaper: *Options → Preferences → Plug-ins → VST → Re-scan*.

## 9. Uso en sesión

1. Abre la web, pon nombre y sala → *Detectar dispositivos* → *Entrar en la sala*.
2. *Copiar enlace* y pásaselo a los demás.
3. **Para emitir**: en *Tu DAW* elige *Plugin Cabina Send* (o BlackHole/VB-Cable) → *Emitir DAW*. Con el plugin no hace falta volver a pulsar aunque lo cierres y lo abras: la web lo espera.
   - Coloca Cabina Send **el último** de la cadena del máster para que salga post-limitador.
4. **Para recibir en tu DAW**:
   1. Crea una pista con **Cabina Retorno** (una por colega).
   2. En la web: *Buscar plugins de retorno*.
   3. En el DAW entrante del colega: *Mandar a mi DAW → Retorno (:47801)*.
   4. Para grabarlo en Reaper: arma la pista con modo *Record: output (stereo)*. También puedes renderizar o mandar esa pista a otra.
5. **Auriculares siempre.** Si suena por altavoces, el micro lo recoge.

> **Chrome y la red local**: desde 2025, Chrome pide permiso cuando una web quiere hablar con programas del propio ordenador (localhost). La primera vez que conectes con un plugin saldrá un aviso de *acceso a la red local*: acéptalo.

## 10. Compilar los plugins

### 10.1 Automático con GitHub (recomendado, sin instalar nada)

1. Crea un repositorio en GitHub y sube esta carpeta.
2. Cada cambio en `plugin/` los compila para **Mac (universal, VST3 + AU)** y **Windows (VST3)**.
3. Genera los instaladores (`.pkg` con `pkgbuild`, `.exe` con Inno Setup) y los sube a la release `plugins`: `https://github.com/<usuario>/<repositorio>/releases/download/plugins/Cabina-Mac.pkg` (y `Cabina-Windows.exe`). Esas URL no cambian, así que la web siempre enlaza a la última versión.

Así no necesitas un PC con Windows para tus colegas de Windows.

**Firmar y notarizar en Mac** (para que macOS no pida *Abrir igualmente* con cada versión). El flujo ya está preparado, pero solo se activa si existen estos secretos en *Settings → Secrets and variables → Actions*; sin ellos se firma "ad-hoc", como hasta ahora:

1. Darse de alta en el Apple Developer Program (99 €/año).
2. En Xcode o en developer.apple.com, crear los certificados **Developer ID Application** y **Developer ID Installer**. En *Acceso a Llaveros*, exportar los dos juntos en un `.p12` con contraseña.
3. Crear una contraseña de app en account.apple.com (*Inicio de sesión y seguridad → Contraseñas de apps*).
4. Secretos:

| Secreto | Valor |
|---|---|
| `MAC_CERT_P12` | el `.p12` en Base64: `base64 -i certificados.p12 \| pbcopy` |
| `MAC_CERT_PASSWORD` | la contraseña del `.p12` |
| `APPLE_ID` | el correo de la cuenta de Apple |
| `APPLE_TEAM_ID` | el Team ID (10 caracteres, en developer.apple.com → Membership) |
| `APPLE_APP_PASSWORD` | la contraseña de app |

Con ellos, los plugins se firman con *Developer ID Application* (con sello de tiempo y *hardened runtime*), el `.pkg` con *Developer ID Installer*, y el `.pkg` se manda a notarizar a Apple y se le grapa el resultado (`stapler`). Los `.zip` sueltos van firmados pero no notarizados. En Windows, quitar el aviso de SmartScreen requiere un certificado de firma de código aparte; no está preparado.

### 10.2 En tu Mac

Requisitos: Xcode Command Line Tools (`xcode-select --install`) y CMake (`brew install cmake`).

```bash
cd plugin
cmake -B ../build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64"
cmake --build ../build --config Release --parallel
```

La primera vez descarga JUCE (~200 MB) y tarda unos minutos. Con `CABINA_COPY_AFTER_BUILD=ON` (por defecto) copia los plugins a tu carpeta de plugins al terminar.

**Desde VS Code**: con la extensión *CMake Tools* (recomendada al abrir el proyecto), pulsa *Build* en la barra inferior. `.vscode/settings.json` ya apunta a `plugin/`.

### 10.3 En Windows

Visual Studio 2022 (carga "Desarrollo para el escritorio con C++") + CMake. Los mismos comandos sin `CMAKE_OSX_ARCHITECTURES`. Para que copie a `Common Files\VST3` hay que abrir la terminal como administrador, o desactivar la copia con `-DCABINA_COPY_AFTER_BUILD=OFF` y copiar a mano.

## 11. Estructura de carpetas

```
cabina/
├── MEMORIA.md                  ← este documento
├── COMERCIALIZACION.md         ← hoja de ruta para venderla (legal, precios, fases)
├── README.md
├── Cabina.code-workspace       ← doble clic para abrir en VS Code
├── .vscode/
│   ├── extensions.json         ← CMake Tools, C/C++, Live Server
│   └── settings.json
├── .github/workflows/
│   ├── compilar.yml            ← compila los plugins, crea instaladores y los publica
│   └── web.yml                 ← publica web/ en GitHub Pages
├── web/
│   ├── index.html              ← toda la web en un archivo
│   ├── icono.png               ← icono de la pestaña (logo de 1st, 180×180)
│   └── hitmarker.mp3           ← sonido de la bola (Freesound 322640, CC0)
└── plugin/
    ├── CMakeLists.txt          ← genera Cabina Send y Cabina Retorno
    └── Source/
        ├── PluginProcessor.h/.cpp   ← audio, colas, hilo de envío
        ├── PluginEditor.h/.cpp      ← interfaz
        └── WebSocketServer.h/.cpp   ← servidor WebSocket mínimo
```

## 12. Costes

| Concepto | Coste |
|---|---|
| Alojamiento de la web (Netlify / GitHub Pages) | 0 € |
| Señalización (servidor público de PeerJS) | 0 € |
| Archivos por el chat (de ordenador a ordenador) | 0 € |
| TURN de relevo (el que trae PeerJS por defecto) | 0 € |
| Compilación (GitHub Actions, repositorio público o cuota gratuita) | 0 € |
| JUCE para uso personal | 0 € (ver §18) |
| **Opcional**: servidor PeerJS + TURN propios en un VPS | ~4–6 €/mes |

## 13. Seguridad y privacidad

- Audio y vídeo van **cifrados de extremo a extremo** (DTLS-SRTP, obligatorio en WebRTC).
- La sala es "privada por oscuridad": quien tenga el nombre puede entrar. Usa nombres poco obvios (`mezcla-ep-x7k2`).
- Los plugins solo escuchan en `127.0.0.1`: nadie de fuera de tu ordenador puede conectarse.
  - Cualquier web que tengas abierta en tu navegador sí podría intentar conectar con Cabina Send y escuchar el máster. La ventana del plugin muestra **desde qué web** está conectado; si no reconoces el origen, quita el plugin.
  - Mejora pendiente: restringir el origen permitido (ver §16).
- No hay cuentas, ni base de datos, ni se guarda nada en servidores.

## 14. Limitaciones conocidas

- **Malla**: con más de 5–6 personas, la subida de cada uno se satura, porque se manda una copia del DAW por persona. Para grupos grandes haría falta un SFU (LiveKit, mediasoup).
- **Servidor público de PeerJS**: sin garantías de disponibilidad. Si falla, montar uno propio (§16).
- **Safari**: la captura estéreo del cable virtual es poco fiable. Con los plugins funciona, pero abriendo Cabina desde el propio plugin (§6), con el DAW y el plugin ya abiertos. **Pendiente de probar en un Safari real** (las pruebas se hicieron imitando el plugin en Chrome).
- **Grabación en la web**: se guarda en memoria; ~230 MB por cada 10 minutos. Es para tomas, no para sesiones de horas.
- **Retorno**: si los relojes de audio derivan, puede haber un pequeño clic cada varios minutos al reajustar el colchón.
- **Safari y la cancelación de eco**: con la cancelación de eco del micro activada, Safari usa el procesado de voz de macOS, que también procesa y baja todo lo que suena, el DAW que escuchas incluido. Por eso en Safari va apagada (`talkAudio()`), y hay que usar auriculares o, si no, los demás oirán eco. En Chrome y Edge sigue activada, porque allí no afecta a lo que se escucha.
- **Probar en un solo ordenador**: si escuchas a la vez el DAW directo y lo que llega por Cabina, suenan dos copias con retardo distinto y parece un phaser. Para probar, silencia una de las dos.
- **Archivos**: máximo 1 GB por archivo y solo a quienes estén en la sala. No se reanudan si se corta la conexión. Para pasar sesiones enteras, mejor WeTransfer o una carpeta compartida.
- **Reducción de ruido fuerte**: depende de jsDelivr (si no carga, avisa y el micro sigue sin filtro). No está en Safari. Gasta algo de CPU.
- **Compartir pantalla**: no funciona en iPhone/iPad (no tienen `getDisplayMedia`) y el botón no aparece. En malla, cada participante recibe una copia (hasta 4 Mbps de subida por oyente).
- **Un solo Cabina Send** abierto a la vez (puerto 47800 fijo). Si hay dos, el segundo muestra "Puerto ocupado" y toma el relevo solo en cuanto se cierra el primero.
  - Por qué importa en Mac: JUCE abre el puerto con `SO_REUSEADDR`. En Windows esa opción deja que una segunda instancia comparta el puerto, pero en macOS no. Algunos DAW (FL Studio en Mac, por ejemplo) crean una instancia temporal del plugin y luego la destruyen. Hasta la v0.1, la instancia buena se quedaba sin puerto para siempre, y la web y el plugin no se veían. Ahora el servidor reintenta cada 0,5 s.
- **AAX / Pro Tools**: no incluido, porque requiere firma de Avid.
- **Plugins sin firmar en Mac**: macOS pide *Abrir igualmente* con cada versión (§8.3). Firmar y notarizar requiere cuenta de desarrollador de Apple (99 €/año); el flujo está listo (§10.1).
- **Dar control del ordenador a otro participante** (para hacer beats en el mismo PC): una web no puede mover el ratón ni pulsar teclas en el ordenador de nadie; los navegadores lo impiden por seguridad. Haría falta la app de escritorio (§16). Mientras, se puede usar algo aparte a la vez que Cabina: *Compartir pantalla* de macOS (permite controlar entre Macs), Chrome Remote Desktop o Parsec.

## 15. Pruebas realizadas

| Prueba | Resultado |
|---|---|
| Sintaxis JavaScript de la web | OK |
| Ajuste de SDP para Opus estéreo 510 kbps | OK: añade `stereo=1; sprop-stereo=1; maxaveragebitrate=510000; useinbandfec=1; usedtx=0` y deja otros códecs intactos |
| Remuestreo `cabina-in` a 44,1 / 48 / 96 kHz → 48 kHz | Seno de 441 Hz reproducido a 441 Hz, sin cortes ni discontinuidades |
| Remuestreo `cabina-out` 48 → 44,1 kHz | 1 s → ~44 100 frames |
| Compilación de ambos plugins (VST3, Linux/GCC 13, JUCE 8.0.9) | OK, sin avisos en el código de Cabina |
| Servidor WebSocket frente a un cliente WebSocket estándar (Node.js 22) | OK: handshake, hello JSON, 50 bloques de audio intactos hacia la web, 20 mensajes de vuelta (incluidos de 400 KB, longitud de 64 bits), cierre y parada limpios |
| Prueba de extremo a extremo (Cabina Send simulado con tonos de 997 Hz en L y 3001 Hz en R → web → WebRTC → web → Cabina Retorno simulado), Chrome sin interfaz | Llega igual que sale: nivel exacto, estéreo sin cruzarse (diafonía < −73 dB). Ruido + distorsión: 24 bit a 48 kHz −125 dB, 24 bit a 44,1 kHz −91 dB, 16 bit −86 dB, Opus −60 dB (normal en un tono puro) |
| La misma, con atascos de 30–90 ms por segundo en las páginas | Antes: 3–6 cortes / 15 s en el emisor y 3 en el Retorno, con cualquier calidad. Con colchones adaptables: 1 corte al principio en el emisor y 0 en el Retorno en 25 s |
| Compartir pantalla con 3 navegadores | Se ve en los demás; quien entra después también la recibe; al parar desaparece |
| Pulsar *Entrar* dos veces | Una sola entrada |
| Archivo aleatorio de 12 MB por el chat | Llega idéntico (SHA-256) en 3 s; el emisor ve "Enviado a 1 persona" |
| Emitir con Cabina Send cerrado → abrirlo → cerrarlo → reabrirlo | Espera, empieza sola, avisa al cerrarse y sigue sola al volver; el oyente no deja de recibir y el nivel llega exacto |
| Reducción de ruido normal ↔ fuerte | La cadena RNNoise se monta, se quita y se vuelve a montar sin errores |
| Abrir Cabina desde el plugin (página de carga del plugin servida igual que en C++, Safari imitado en Chrome) | Aviso con el enlace correcto; la página del plugin carga la web, es segura, trae nombre y sala, emite sin ventanita, y *Copiar enlace* da el enlace público; un oyente en la web normal recibe el DAW |
| Espejo | Por defecto los demás te ven en espejo, igual que tú; al quitarlo, cambia para ti y para ellos |
| Safari que ya permite hablar con 127.0.0.1 / que lo bloquea (imitados en Chrome) | El primero emite directamente sin cambiar de página; el segundo muestra el aviso y, al pulsarlo, entra solo en la sala y emite |
| Filtro de perrito (cámara de prueba con un retrato) | Detecta la cara, dibuja orejas, nariz y lengua; el otro participante lo recibe; al quitarlo vuelve la cámara normal |
| Brillo al hablar | Sigue los pitidos del micro de prueba; con el micro silenciado no se enciende |
| Estado de conexión y volumen por persona | Punto verde con la latencia; el volumen se aplica y se recuerda por nombre |
| Cambiar de micro dentro de la sala (3 micros de prueba, ruido normal y fuerte) | El otro sigue oyendo en todos los casos |
| Sala con 4 navegadores: corte de red, la anfitriona sale, entra alguien nuevo, la anfitriona nueva cierra la pestaña | Siempre se vuelven a ver todos (en 6–15 s); quien entra después llega a la misma sala |
| Archivos WAV, PNG y FLP por el chat | Tarjetas con extensión y estado; el WAV se puede escuchar y el PNG se ve; quien envía ve "Enviado a 2 personas" |
| Pantalla compartida con 3 personas | Cámaras pequeñas y centradas bajo la pantalla |

Pendiente de probar en real: sesión entre dos ordenadores en redes distintas, y los plugins en Reaper en Mac y Windows.

## 16. Hoja de ruta

**Corto plazo**
- [ ] Prueba real con 2–3 colegas; ajustar el colchón del Retorno según los resultados.
- [ ] Lista de orígenes permitidos en los plugins (solo la URL de Cabina).
- [ ] Leer el WebSocket de los plugins en un Worker y pasarlo directo al `AudioWorklet` (`MessageChannel`), para no depender del hilo principal. Antes, comprobar que el permiso de red local de Chrome lo permite desde un Worker.
- [ ] Botón "marcar tiempo" en el chat que inserte la posición del transporte del DAW (el plugin la conoce).

**Medio plazo**
- [ ] Servidor PeerJS + TURN propios (coturn) en un VPS barato.
- [x] Compartir archivos arrastrando (stems, bounces) por el canal de datos.
- [ ] Cuenta de desarrollador de Apple para firmar los plugins (el flujo ya está listo, §10.1).
- [ ] Lo necesario para venderla: ver `COMERCIALIZACION.md`.
- [ ] Talkback desde el plugin (botón para hablar sin salir del DAW).

**Largo plazo**
- [ ] SFU para salas grandes.
- [ ] App de escritorio (Tauri) con el plugin integrado y sin depender del navegador. Permitiría también dar control del ordenador a otro participante.

## 17. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| "No encuentro el plugin Cabina Send" | Plugin no cargado, o Chrome bloqueó el acceso local | Cargar el plugin en el máster; aceptar el aviso de red local de Chrome |
| El plugin dice "Puerto ocupado" | Otro proyecto o instancia lo está usando | Cerrar la otra instancia |
| Safari: "no puede conectarse al servidor 127.0.0.1" | Cabina Send no está en el máster o no escucha (en la ventana del plugin debe poner la dirección `127.0.0.1:47800`) | Poner el plugin en el máster; si estaba y no escucha, quitarlo y volver a ponerlo; plugins de antes del 23-10-2026: reinstalar |
| Safari: tras *Abrir Cabina desde el plugin*, página en blanco o "no encontrado" | FL Studio (o el DAW) se abrió antes de instalar el plugin nuevo y sigue usando el viejo en memoria (responde en `/puente`, no en `/`) | Cerrar el DAW del todo y volver a abrirlo |
| Safari: se abre sola una ventanita con ese error | Web anterior al 23-10-2026 (ventanita puente) | Recargar la web; ahora se abre Cabina desde el plugin |
| Llega en mono | Safari, o cable virtual configurado en mono | Usar Chrome; revisar el dispositivo en Audio MIDI |
| kbps muy por debajo de 400 | Red congestionada; WebRTC baja la calidad solo | Cable de red en vez de wifi; cerrar descargas |
| Suena desfasado, como con un canal de más | El micro de quien emite capta el DAW (altavoces, monitorización directa, loopback de la interfaz) y llega dos veces | Auriculares o silenciar el micro. La web avisa al emisor si lo detecta |
| "% retocado" alto en el DAW entrante | WebRTC estira o rellena audio por pérdidas o jitter de la red | Cable de red; probar el modo sin pérdidas |
| Eco o acoples | Altavoces en lugar de auriculares | Auriculares |
| No conecta con alguien concreto | Router o NAT estricto | Normalmente lo salva el TURN; si no, montar TURN propio |
| En el DAW suena a trozos | El colchón del Retorno se vacía | Debería adaptarse solo en unos segundos (la ventana del plugin muestra el colchón). Si sigue, subir el valor inicial de `returnBuffer` en `PluginProcessor.h` (0.06 → 0.12) |
| Al emitir, la web pone "N cortes" junto al plugin | La página del emisor se atasca (segundo plano, ordenador cargado) | El colchón crece solo; si siguen apareciendo, dejar la ventana de Cabina visible o cerrar pestañas pesadas |
| Alguien aparece dos veces en la sala | Pulsó *Entrar* dos veces con una web anterior al 22-10-2026 | Que recargue la web y vuelva a entrar |
| Suena con efecto phaser al probar en un solo ordenador | Se oyen a la vez el DAW directo y lo que llega por Cabina | Silenciar una de las dos |
| En Safari todo suena más bajo o "enlatado" con el micro abierto | Procesado de voz de macOS (versión anterior al 21-10-2026) | Recargar la web; usar auriculares |

## 18. Licencias

- **JUCE 8**: doble licencia, AGPLv3 o comercial. Para uso personal entre colegas, sin vender, encaja en la AGPLv3 publicando el código (el repositorio de GitHub sirve). Si algún día se vende, revisar las condiciones de licencia de JUCE.
- **PeerJS**: MIT.
- **web-noise-suppressor** (RNNoise): MIT; RNNoise es BSD.
- **MediaPipe tasks-vision** y el modelo Face Landmarker: Apache 2.0.
- **Logo de 1st** (`web/icono.png`): propio.
- **hitmarker.mp3**: CC0 (aruscio28, Freesound 322640).
- El código de Cabina es tuyo. Si lo publicas, AGPLv3 por coherencia con JUCE.
