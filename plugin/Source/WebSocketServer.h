#pragma once

#include <juce_core/juce_core.h>
#include <atomic>

/*
    Servidor WebSocket mínimo (RFC 6455), solo en 127.0.0.1.
    Sin dependencias externas: lo justo para que la web de Cabina
    hable con el plugin por localhost.

    - Un hilo acepta conexiones; cada cliente tiene su propio hilo de lectura.
    - sendBinary()/sendText() envían a todos los clientes conectados.
*/
class WebSocketServer : private juce::Thread
{
public:
    struct Listener
    {
        virtual ~Listener() = default;
        /** Mensaje de texto (JSON) que se envía a cada cliente nada más conectar. */
        virtual juce::String helloMessage() = 0;
        /** Llamado desde el hilo del cliente al recibir un mensaje binario. */
        virtual void binaryReceived (const void* data, size_t size) { juce::ignoreUnused (data, size); }
    };

    explicit WebSocketServer (Listener& l);
    ~WebSocketServer() override;

    /** Intenta escuchar en el primer puerto libre del rango. Devuelve el puerto o -1. */
    int start (int firstPort, int lastPort);
    void stop();

    void sendBinary (const void* data, size_t size)  { broadcast (0x2, data, size); }
    void sendText (const juce::String& text);

    int getNumClients() const noexcept               { return numClients.load(); }
    juce::String getLastOrigin() const;

private:
    class Client;
    friend class Client;

    void run() override;
    void broadcast (int opcode, const void* data, size_t size);
    void removeDeadClients();
    void setLastOrigin (const juce::String& o);

    Listener& listener;
    juce::StreamingSocket serverSocket;
    juce::CriticalSection lock;
    juce::OwnedArray<Client> clients;
    std::atomic<int> numClients { 0 };
    juce::String lastOrigin;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebSocketServer)
};
