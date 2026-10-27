# Cabina: hoja de ruta para comercializarla

Escrita el 26/10/2026. Precios y condiciones de terceros comprobados en esa fecha (ver Fuentes); conviene revisarlos antes de cada paso.

## Antes de cobrar: tres cosas que lo bloquean hoy

1. **Seguridad de las salas.** ~~Los plugins aceptaban conexiones de cualquier web~~: resuelto el 27-10-2026, ahora solo aceptan la web de Cabina. Queda que cualquiera que adivine el nombre de una sala puede entrar y oír el DAW. Con usuarios de pago, una filtración de una canción sin publicar sería gravísima (ver MEMORIA.md §13).
2. **Licencia de JUCE.** Los plugins usan JUCE, que tiene tres licencias:
   - **Starter**: gratis hasta 20.000 $ de ingresos al año.
   - **Indie**: 40 $/mes (u 800 $ de por vida) hasta 300.000 $.
   - **Pro**: 175 $/mes, sin límite.

   La otra vía es la licencia AGPL, que obliga a publicar todo el código. Para empezar sirve Starter; al pasar de 20.000 $ hay que subir a Indie.
3. **Servidores propios.** Ahora se depende de dos piezas gratuitas que no son nuestras:
   - El servidor público de PeerJS, que pone en contacto a los navegadores: no garantiza nada y no está pensado para un producto comercial.
   - El servidor TURN, que hace de relevo cuando dos routers no se dejan conectar directamente.

   Con clientes de pago hacen falta los propios.

## Fases

### Fase 0 · Validar (1–2 meses, casi sin gastos)
- Beta cerrada con 10–20 productores e ingenieros que no sean amigos.
- Pruebas reales: redes distintas, Windows, varios DAW (Logic, Ableton, Pro Tools, FL), Safari.
- Pregunta directa: ¿pagarían? ¿Cuánto? ¿Qué echan en falta?
- Si nadie lo pagaría, mejor saberlo antes de gastar.

### Fase 1 · Producto vendible (2–4 meses)
- **Cuentas e invitaciones.** Hoy, quien adivine el nombre de una sala puede entrar. Hacen falta cuentas de usuario, salas con contraseña o invitación, y que el anfitrión pueda bloquear la entrada.
- **Servidores propios** para poner en contacto a los navegadores y hacer de relevo (en un VPS o un servicio gestionado). Orientativo: de 10 a 50 €/mes al principio. El relevo se paga por gigas transferidos, y el modo sin pérdidas consume mucho.
- **Plugins firmados**, para que el sistema no muestre avisos al instalarlos:
  - Mac: cuenta de desarrollador de Apple, 99 €/año (el flujo de compilación ya está preparado, ver MEMORIA.md).
  - Windows: un certificado de firma de código.
- ~~Que los plugins solo hablen con la web de Cabina~~ (hecho el 27-10-2026).
- **Marca y web de venta**: dominio propio, página de presentación y nombre. Antes de invertir, comprobar en la OEPM y la EUIPO que "Cabina" se puede registrar como marca.

### Fase 2 · Lanzar
- **Pagos con un "merchant of record"** (Paddle o Lemon Squeezy): se encargan del IVA de cada país de la UE y de las facturas. Con Stripe directamente hay que gestionarlo uno mismo.
- **Textos legales**: política de privacidad, términos y aviso legal.
- **Soporte**: correo y una página de ayuda (se puede partir de MEMORIA.md).
- **Detección de errores** (Sentry o similar), para enterarse de los fallos sin que los cuenten.

### Fase 3 · Crecer
- **Salas grandes**: un servidor que reparta el audio (SFU, como LiveKit). Hoy cada uno manda una copia a cada persona y con más de 5–6 no da abasto.
- **AAX para Pro Tools**: requiere firmarlo con Avid y PACE.
- **App de escritorio**: ya existe una primera versión (Electron, sin firmar, ver MEMORIA.md §5). Para venderla: firmarla (Apple 99 €/año; Windows, certificado aparte), actualizaciones automáticas y dar control del ordenador.

## Precio y competencia

La referencia es **Audiomovers LISTENTO**: unos 100 $/año el Basic y 200 $/año el Pro. Solo emite audio. Cabina junta en una sola sala audio en alta calidad, vídeo, voz, chat, pantalla compartida, archivos y la vuelta al DAW, y quien solo escucha no instala nada.

Modelo sugerido, para ajustar con lo que diga la beta:
- **Gratis**: escuchar y salas de 2 personas con Opus.
- **Pro (5–8 €/mes, o 50–80 €/año)**: sin pérdidas, más personas, retorno al DAW y grabación.

## Aspectos legales (en España)

| Tema | Qué implica |
|---|---|
| Forma jurídica | Para empezar, alta como **autónomo**; si crece o entra un socio, una **SL**. Consultarlo con un gestor. |
| RGPD | Aunque el audio vaya directo entre ordenadores, los servidores propios ven las IP y las cuentas. Hace falta política de privacidad, contratos con cada proveedor (hosting, pagos) y cuidado con los datos que salen de la UE. |
| LSSI | Un **aviso legal** en la web con los datos de contacto o de la empresa. |
| Desistimiento | En suscripciones digitales, el cliente puede devolverla en 14 días, salvo que acepte expresamente empezar a usarla ya. Se pone al pagar. |
| Google Fonts | Cargar las fuentes desde Google ya ha dado multas en la UE. Se soluciona alojándolas en el propio servidor. |
| Licencias de terceros | PeerJS (MIT), RNNoise (BSD), MediaPipe (Apache) y el hitmarker (CC0) se pueden usar comercialmente; basta con citarlas en una página de créditos. JUCE, como arriba. |
| Accesibilidad | La ley europea de accesibilidad exime a las microempresas (menos de 10 empleados y menos de 2 M€). Aun así, conviene cuidarla. |

## Lo que más puede salir mal

- **Conexiones que fallan entre redes reales.** Casi todo se ha probado en un solo ordenador.
- **Safari**: sin probar del todo en real.
- **El coste del relevo** si muchos clientes usan el modo sin pérdidas a través de él.
- **Soporte técnico**: cada DAW y cada tarjeta de sonido dan problemas distintos.

## Fuentes

- JUCE 8 y sus licencias: https://forum.juce.com/t/juce-8-is-available-now/61809 · https://forum.juce.com/t/amendments-to-the-juce-end-user-licence-agreement-for-juce-8/61265 · https://forum.juce.com/t/revenue-limits-for-juce-tiers/61058
- Audiomovers: https://sonicstate.com/news/2025/08/08/remote-collaboration-tool-updated/ · https://audiomovers.com/bundles/ · https://www.prosoundweb.com/audiomovers-announces-updates-for-listento-application/
- Safari y 127.0.0.1: https://github.com/WebKit/WebKit/pull/72974 · https://bugs.webkit.org/show_bug.cgi?id=171934
