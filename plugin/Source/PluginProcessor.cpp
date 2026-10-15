#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace
{
    // JUCE 7 usa String y JUCE 8 std::optional<String> para el nombre de la pista
    [[maybe_unused]] juce::String nameFrom (const juce::String& s)                { return s; }
    [[maybe_unused]] juce::String nameFrom (const std::optional<juce::String>& s) { return s.value_or (juce::String()); }

    constexpr int sendChunkFrames = 1024;
}

CabinaProcessor::CabinaProcessor()
    : juce::AudioProcessor (BusesProperties()
                              .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
                              .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      juce::Thread ("Cabina envio"),
      ring ((size_t) fifoFrames * 2, 0.0f)
{
    peak[0] = 0.0f;
    peak[1] = 0.0f;

    if (isReturn) server.start (firstReturnPort, lastReturnPort);
    else          server.start (sendPort, sendPort);

    if (! isReturn)
        startThread();
}

CabinaProcessor::~CabinaProcessor()
{
    stopThread (2000);
    server.stop();
}

void CabinaProcessor::prepareToPlay (double sr, int)
{
    const auto old = sampleRate.exchange (sr);
    buffering = true;

    if (std::abs (old - sr) > 0.5)
        server.sendText (helloMessage()); // la web ajusta el remuestreo
}

bool CabinaProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    const auto out = layouts.getMainOutputChannelSet();
    if (out != juce::AudioChannelSet::mono() && out != juce::AudioChannelSet::stereo())
        return false;
    return layouts.getMainInputChannelSet() == out;
}

void CabinaProcessor::updateTrackProperties (const TrackProperties& props)
{
    {
        const juce::ScopedLock sl (nameLock);
        trackName = nameFrom (props.name);
    }
    server.sendText (helloMessage());
}

juce::String CabinaProcessor::helloMessage()
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("type", "hello");
    obj->setProperty ("role", isReturn ? "return" : "send");
    obj->setProperty ("sr",   sampleRate.load());
    obj->setProperty ("ch",   2);
    obj->setProperty ("port", server.getPort());
    {
        const juce::ScopedLock sl (nameLock);
        obj->setProperty ("name", trackName);
    }
    return juce::JSON::toString (juce::var (obj), true);
}

//==============================================================================
void CabinaProcessor::updatePeaks (const float* l, const float* r, int n) noexcept
{
    float pl = 0.0f, pr = 0.0f;
    for (int i = 0; i < n; ++i)
    {
        pl = juce::jmax (pl, std::abs (l[i]));
        pr = juce::jmax (pr, std::abs (r[i]));
    }
    if (pl > peak[0].load()) peak[0] = pl;
    if (pr > peak[1].load()) peak[1] = pr;
}

void CabinaProcessor::writeFrames (const float* l, const float* r, int frames)
{
    int s1, n1, s2, n2;
    fifo.prepareToWrite (frames, s1, n1, s2, n2); // si no cabe, se descarta el sobrante

    auto copy = [&] (int start, int count, int offset)
    {
        for (int i = 0; i < count; ++i)
        {
            ring[(size_t) (start + i) * 2]     = l[offset + i];
            ring[(size_t) (start + i) * 2 + 1] = r[offset + i];
        }
    };
    copy (s1, n1, 0);
    copy (s2, n2, n1);
    fifo.finishedWrite (n1 + n2);
}

void CabinaProcessor::writeFrames (const float* interleaved, int frames)
{
    int s1, n1, s2, n2;
    fifo.prepareToWrite (frames, s1, n1, s2, n2);
    if (n1 > 0) std::memcpy (&ring[(size_t) s1 * 2], interleaved,          (size_t) n1 * 2 * sizeof (float));
    if (n2 > 0) std::memcpy (&ring[(size_t) s2 * 2], interleaved + n1 * 2, (size_t) n2 * 2 * sizeof (float));
    fifo.finishedWrite (n1 + n2);
}

//==============================================================================
void CabinaProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int n = buffer.getNumSamples();
    const int numCh = buffer.getNumChannels();
    if (numCh == 0 || n == 0)
        return;

    if constexpr (! isReturn)
    {
        // ---- SEND: el audio pasa intacto y se copia a la cola de envío ----
        const float* l = buffer.getReadPointer (0);
        const float* r = numCh > 1 ? buffer.getReadPointer (1) : l;
        updatePeaks (l, r, n);

        if (server.getNumClients() > 0)
            writeFrames (l, r, n);
    }
    else
    {
        // ---- RETORNO: sustituye la entrada por el audio que llega de la web ----
        float* l = buffer.getWritePointer (0);
        float* r = numCh > 1 ? buffer.getWritePointer (1) : nullptr;

        const int target = (int) (sampleRate.load() * 0.06); // colchón de 60 ms
        int ready = fifo.getNumReady();

        if (ready > target * 6) // demasiada latencia acumulada: saltamos hacia delante
        {
            fifo.finishedRead (ready - target);
            ready = target;
        }

        if (buffering.load())
        {
            if (ready >= target)
                buffering = false;
            else
            {
                buffer.clear();
                return;
            }
        }

        int s1, n1, s2, n2;
        fifo.prepareToRead (n, s1, n1, s2, n2);

        auto copy = [&] (int start, int count, int offset)
        {
            for (int i = 0; i < count; ++i)
            {
                l[offset + i] = ring[(size_t) (start + i) * 2];
                if (r != nullptr)
                    r[offset + i] = ring[(size_t) (start + i) * 2 + 1];
                else
                    l[offset + i] = 0.5f * (l[offset + i] + ring[(size_t) (start + i) * 2 + 1]);
            }
        };
        copy (s1, n1, 0);
        copy (s2, n2, n1);
        fifo.finishedRead (n1 + n2);

        const int got = n1 + n2;
        if (got < n) // nos hemos quedado sin audio: silencio y volvemos a llenar el colchón
        {
            for (int ch = 0; ch < numCh; ++ch)
                buffer.clear (ch, got, n - got);
            buffering = true;
        }

        for (int ch = 2; ch < numCh; ++ch)
            buffer.clear (ch, 0, n);

        updatePeaks (buffer.getReadPointer (0), buffer.getReadPointer (numCh > 1 ? 1 : 0), n);
    }
}

//==============================================================================
void CabinaProcessor::run()
{
    // Hilo de envío (Send): vacía la cola y manda bloques de 1024 frames float32 intercalados
    std::vector<float> chunk ((size_t) sendChunkFrames * 2);

    while (! threadShouldExit())
    {
        wait (5);

        for (;;)
        {
            const int avail = fifo.getNumReady();
            if (avail <= 0)
                break;

            const int want = juce::jmin (avail, sendChunkFrames);
            int s1, n1, s2, n2;
            fifo.prepareToRead (want, s1, n1, s2, n2);
            if (n1 > 0) std::memcpy (chunk.data(),          &ring[(size_t) s1 * 2], (size_t) n1 * 2 * sizeof (float));
            if (n2 > 0) std::memcpy (chunk.data() + n1 * 2, &ring[(size_t) s2 * 2], (size_t) n2 * 2 * sizeof (float));
            fifo.finishedRead (n1 + n2);

            if (server.getNumClients() > 0)
                server.sendBinary (chunk.data(), (size_t) (n1 + n2) * 2 * sizeof (float));
        }
    }
}

void CabinaProcessor::binaryReceived (const void* data, size_t size)
{
    // Retorno: float32 estéreo intercalado, ya remuestreado por la web al sample rate del DAW
    if constexpr (isReturn)
    {
        const int frames = (int) (size / (2 * sizeof (float)));
        if (frames > 0)
            writeFrames (static_cast<const float*> (data), frames);
    }
    else
    {
        juce::ignoreUnused (data, size);
    }
}

//==============================================================================
juce::AudioProcessorEditor* CabinaProcessor::createEditor()
{
    return new CabinaEditor (*this);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new CabinaProcessor();
}
