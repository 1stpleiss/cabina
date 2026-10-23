#include "WebSocketServer.h"
#include <cstring>
#if JUCE_MAC || JUCE_IOS
 #include <sys/socket.h>
#endif

namespace
{
    // ---------- SHA-1 (solo para el handshake de WebSocket) ----------
    inline uint32_t rol (uint32_t v, int b) { return (v << b) | (v >> (32 - b)); }

    void sha1 (const uint8_t* data, size_t len, uint8_t out[20])
    {
        uint32_t h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

        std::vector<uint8_t> msg (data, data + len);
        const uint64_t bitLen = (uint64_t) len * 8;
        msg.push_back (0x80);
        while (msg.size() % 64 != 56)
            msg.push_back (0);
        for (int i = 7; i >= 0; --i)
            msg.push_back ((uint8_t) (bitLen >> (i * 8)));

        for (size_t chunk = 0; chunk < msg.size(); chunk += 64)
        {
            uint32_t w[80];
            for (int i = 0; i < 16; ++i)
                w[i] = (uint32_t) msg[chunk + (size_t) i * 4] << 24 | (uint32_t) msg[chunk + (size_t) i * 4 + 1] << 16
                     | (uint32_t) msg[chunk + (size_t) i * 4 + 2] << 8 | (uint32_t) msg[chunk + (size_t) i * 4 + 3];
            for (int i = 16; i < 80; ++i)
                w[i] = rol (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

            uint32_t a = h0, b = h1, c = h2, d = h3, e = h4;
            for (int i = 0; i < 80; ++i)
            {
                uint32_t f, k;
                if (i < 20)      { f = (b & c) | (~b & d);           k = 0x5A827999; }
                else if (i < 40) { f = b ^ c ^ d;                    k = 0x6ED9EBA1; }
                else if (i < 60) { f = (b & c) | (b & d) | (c & d);  k = 0x8F1BBCDC; }
                else             { f = b ^ c ^ d;                    k = 0xCA62C1D6; }
                const uint32_t t = rol (a, 5) + f + e + k + w[i];
                e = d; d = c; c = rol (b, 30); b = a; a = t;
            }
            h0 += a; h1 += b; h2 += c; h3 += d; h4 += e;
        }

        const uint32_t hs[5] = { h0, h1, h2, h3, h4 };
        for (int i = 0; i < 5; ++i)
            for (int j = 0; j < 4; ++j)
                out[i * 4 + j] = (uint8_t) (hs[i] >> (24 - j * 8));
    }

    constexpr size_t maxMessageBytes = 8 * 1024 * 1024;

    // Cabina servida desde el propio plugin, para Safari: Safari no deja que una web https hable con
    // ws://127.0.0.1 (contenido mixto), pero una página de http://127.0.0.1 sí puede, y además cuenta
    // como segura (micro y cámara). Esta página descarga la web publicada y la pone en su lugar, así
    // que los cambios de la web llegan sin recompilar el plugin.
    // Solo ASCII (entidades HTML) para que compile igual en todos los sistemas.
   #ifndef CABINA_WEB_URL
    #define CABINA_WEB_URL "https://1stpleiss.github.io/cabina/"
   #endif
    const std::string loaderPage = std::string (R"HTML(<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Cabina</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d0e10;color:#8d929a;font:14px system-ui,sans-serif">
<p id="s">Cargando Cabina&hellip;</p>
<script>
const WEB = ")HTML") + CABINA_WEB_URL + R"HTML(";
fetch(WEB + "index.html", { cache: "no-store" })
  .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then(h => {
    h = h.split('href="icono.png"').join('href="' + WEB + 'icono.png"')
         .replace("<head>", "<head><script>window.CABINA_WEB = " + JSON.stringify(WEB) + "<\/script>");
    document.open(); document.write(h); document.close();
  })
  .catch(() => { document.getElementById("s").textContent = "No se pudo descargar Cabina de " + WEB + ". \u00bfHay conexi\u00f3n a internet?"; });
</script></html>)HTML";
}

//==============================================================================
class WebSocketServer::Client : public juce::Thread
{
public:
    Client (WebSocketServer& o, juce::StreamingSocket* s)
        : juce::Thread ("Cabina WS cliente"), owner (o), socket (s)
    {
       #if JUCE_MAC || JUCE_IOS
        // Si la web se cierra mientras enviamos, que write() devuelva error en vez de
        // lanzar SIGPIPE, que puede cerrar el DAW entero
        int one = 1;
        setsockopt (socket->getRawSocketHandle(), SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof (one));
       #endif
    }

    ~Client() override
    {
        socket->close();
        stopThread (2000);
    }

    bool isFinished() const noexcept { return finished.load(); }

    void send (int opcode, const void* data, size_t size)
    {
        if (open.load())
            writeFrame (opcode, data, size);
    }

    void run() override
    {
        if (handshake())
        {
            const auto hello = owner.listener.helloMessage().toStdString();
            writeFrame (0x1, hello.data(), hello.size());
            open = true;
            ++owner.numClients;
            readLoop();
        }

        if (open.exchange (false))
            --owner.numClients;

        socket->close();
        finished = true;
    }

private:
    bool readFully (void* dest, size_t n)
    {
        auto* p = static_cast<char*> (dest);
        while (n > 0)
        {
            if (threadShouldExit())
                return false;
            const int got = socket->read (p, (int) n, true);
            if (got <= 0)
                return false;
            p += got;
            n -= (size_t) got;
        }
        return true;
    }

    bool handshake()
    {
        // Que una conexión que no dice nada (las que Safari abre por adelantado) no ocupe un hilo para siempre
        if (socket->waitUntilReady (true, 5000) != 1)
            return false;

        std::string req;
        char c;
        while (req.size() < 8192)
        {
            if (! readFully (&c, 1))
                return false;
            // Safari prueba primero https://127.0.0.1. Si llega TLS (o cualquier cosa que no
            // sea HTTP) se cierra al momento para que vuelva a http; si no, se queda colgado.
            if (req.empty() && ! (c >= 'A' && c <= 'Z'))
                return false;
            req.push_back (c);
            if (req.size() >= 4 && req.compare (req.size() - 4, 4, "\r\n\r\n") == 0)
                break;
        }

        juce::String key, origin;
        const auto lines = juce::StringArray::fromLines (juce::String (req));
        for (auto& line : lines)
        {
            const auto name  = line.upToFirstOccurrenceOf (":", false, false).trim();
            const auto value = line.fromFirstOccurrenceOf (":", false, false).trim();
            if (name.equalsIgnoreCase ("Sec-WebSocket-Key")) key = value;
            else if (name.equalsIgnoreCase ("Origin"))       origin = value;
        }

        if (key.isEmpty())
        {
            // Petición HTTP normal: solo servimos Cabina para Safari (la raíz)
            std::string resp;
            if (lines[0].startsWith ("GET / ") || lines[0].startsWith ("GET /?"))
                resp = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\n"
                       "Connection: close\r\nContent-Length: " + std::to_string (loaderPage.size()) + "\r\n\r\n" + loaderPage;
            else
                resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            socket->write (resp.data(), (int) resp.size());
            return false;
        }

        const auto src = (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toStdString();
        uint8_t digest[20];
        sha1 (reinterpret_cast<const uint8_t*> (src.data()), src.size(), digest);
        const auto accept = juce::Base64::toBase64 (digest, sizeof (digest));

        const auto resp = ("HTTP/1.1 101 Switching Protocols\r\n"
                           "Upgrade: websocket\r\n"
                           "Connection: Upgrade\r\n"
                           "Sec-WebSocket-Accept: " + accept + "\r\n\r\n").toStdString();

        if (socket->write (resp.data(), (int) resp.size()) != (int) resp.size())
            return false;

        owner.setLastOrigin (origin.isNotEmpty() ? origin : juce::String ("(sin origen)"));
        return true;
    }

    void readLoop()
    {
        juce::MemoryBlock payload, message;
        int messageOpcode = 0;

        while (! threadShouldExit())
        {
            uint8_t h[2];
            if (! readFully (h, 2))
                return;

            const bool fin    = (h[0] & 0x80) != 0;
            const int  opcode = h[0] & 0x0F;
            const bool masked = (h[1] & 0x80) != 0;
            uint64_t len      = h[1] & 0x7F;

            if (len == 126)
            {
                uint8_t e[2];
                if (! readFully (e, 2)) return;
                len = (uint64_t) e[0] << 8 | e[1];
            }
            else if (len == 127)
            {
                uint8_t e[8];
                if (! readFully (e, 8)) return;
                len = 0;
                for (auto b : e) len = (len << 8) | b;
            }

            if (len > maxMessageBytes)
                return;

            uint8_t mask[4] = { 0, 0, 0, 0 };
            if (masked && ! readFully (mask, 4))
                return;

            payload.setSize ((size_t) len, false);
            if (len > 0 && ! readFully (payload.getData(), (size_t) len))
                return;

            if (masked)
            {
                auto* p = static_cast<uint8_t*> (payload.getData());
                for (size_t i = 0; i < (size_t) len; ++i)
                    p[i] ^= mask[i & 3];
            }

            switch (opcode)
            {
                case 0x8: // cierre
                    writeFrame (0x8, payload.getData(), payload.getSize());
                    return;

                case 0x9: // ping → pong
                    writeFrame (0xA, payload.getData(), payload.getSize());
                    break;

                case 0xA: // pong
                    break;

                case 0x1:
                case 0x2:
                    messageOpcode = opcode;
                    message = payload;
                    if (fin) dispatch (messageOpcode, message);
                    break;

                case 0x0: // continuación
                    if (message.getSize() + payload.getSize() > maxMessageBytes)
                        return;
                    message.append (payload.getData(), payload.getSize());
                    if (fin) dispatch (messageOpcode, message);
                    break;

                default:
                    return;
            }
        }
    }

    void dispatch (int opcode, juce::MemoryBlock& msg)
    {
        if (opcode == 0x2 && msg.getSize() > 0)
            owner.listener.binaryReceived (msg.getData(), msg.getSize());
        msg.reset();
    }

    void writeFrame (int opcode, const void* data, size_t size)
    {
        juce::MemoryBlock frame;
        uint8_t header[10];
        size_t headerSize = 2;

        header[0] = (uint8_t) (0x80 | (opcode & 0x0F));
        if (size < 126)
        {
            header[1] = (uint8_t) size;
        }
        else if (size <= 0xFFFF)
        {
            header[1] = 126;
            header[2] = (uint8_t) (size >> 8);
            header[3] = (uint8_t) size;
            headerSize = 4;
        }
        else
        {
            header[1] = 127;
            for (int i = 0; i < 8; ++i)
                header[2 + i] = (uint8_t) ((uint64_t) size >> (56 - i * 8));
            headerSize = 10;
        }

        frame.append (header, headerSize);
        if (size > 0)
            frame.append (data, size);

        const juce::ScopedLock sl (writeLock);
        if (socket->write (frame.getData(), (int) frame.getSize()) != (int) frame.getSize())
            socket->close(); // el hilo de lectura detectará el cierre y limpiará
    }

    WebSocketServer& owner;
    std::unique_ptr<juce::StreamingSocket> socket;
    juce::CriticalSection writeLock;
    std::atomic<bool> open { false }, finished { false };
};

//==============================================================================
WebSocketServer::WebSocketServer (Listener& l)
    : juce::Thread ("Cabina WS servidor"), listener (l) {}

WebSocketServer::~WebSocketServer()
{
    stop();
}

int WebSocketServer::start (int first, int last)
{
    firstPort = first;
    lastPort = last;
    tryListen();
    startThread(); // si no hay puerto libre, el hilo lo reintenta
    return port.load();
}

bool WebSocketServer::tryListen()
{
    for (int p = firstPort; p <= lastPort; ++p)
    {
        if (serverSocket.createListener (p, "127.0.0.1"))
        {
            port = p;
            return true;
        }
    }
    return false;
}

void WebSocketServer::stop()
{
    signalThreadShouldExit();
    notify(); // por si está esperando a que se libere el puerto
    serverSocket.close(); // JUCE desbloquea accept() al cerrar
    stopThread (3000);

    juce::OwnedArray<Client> toDelete;
    {
        const juce::ScopedLock sl (lock);
        toDelete.swapWith (clients);
    }
    toDelete.clear(); // fuera del lock: cada cliente cierra su socket y para su hilo
}

void WebSocketServer::run()
{
    int failures = 0;

    while (! threadShouldExit())
    {
        if (port.load() < 0 && ! tryListen())
        {
            wait (500);
            continue;
        }

        std::unique_ptr<juce::StreamingSocket> s (serverSocket.waitForNextConnection());

        if (threadShouldExit())
            break;

        if (s == nullptr)
        {
            // Si el puerto deja de aceptar conexiones (el sistema lo ha cerrado), se vuelve a abrir
            // en vez de quedarse esperando para siempre sin que la web pueda conectar
            if (++failures >= 20)
            {
                failures = 0;
                serverSocket.close();
                port = -1;
            }
            juce::Thread::sleep (50);
            continue;
        }

        failures = 0;

        removeDeadClients();

        auto* c = new Client (*this, s.release());
        {
            const juce::ScopedLock sl (lock);
            clients.add (c);
        }
        c->startThread();
    }
}

void WebSocketServer::sendText (const juce::String& text)
{
    const auto s = text.toStdString();
    broadcast (0x1, s.data(), s.size());
}

void WebSocketServer::broadcast (int opcode, const void* data, size_t size)
{
    const juce::ScopedLock sl (lock);
    for (auto* c : clients)
        c->send (opcode, data, size);
}

void WebSocketServer::removeDeadClients()
{
    juce::OwnedArray<Client> dead;
    {
        const juce::ScopedLock sl (lock);
        for (int i = clients.size(); --i >= 0;)
            if (clients[i]->isFinished())
                dead.add (clients.removeAndReturn (i));
    }
}

void WebSocketServer::setLastOrigin (const juce::String& o)
{
    const juce::ScopedLock sl (lock);
    lastOrigin = o;
}

juce::String WebSocketServer::getLastOrigin() const
{
    const juce::ScopedLock sl (lock);
    return lastOrigin;
}
