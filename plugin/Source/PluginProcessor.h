#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "WebSocketServer.h"
#include <optional>

#ifndef CABINA_RETURN
 #define CABINA_RETURN 0
#endif

/*
    Cabina Send    (CABINA_RETURN=0): deja pasar el audio sin tocarlo y lo emite a la web
                                      por ws://127.0.0.1:47800.
    Cabina Retorno (CABINA_RETURN=1): recibe de la web el DAW de un colega y lo saca
                                      por la pista, para escucharlo o grabarlo.
                                      Puertos 47801–47808 (uno por instancia).
*/
class CabinaProcessor : public juce::AudioProcessor,
                        private WebSocketServer::Listener,
                        private juce::Thread
{
public:
    static constexpr bool isReturn  = CABINA_RETURN != 0;
    static constexpr int  sendPort  = 47800;
    static constexpr int  firstReturnPort = 47801;
    static constexpr int  lastReturnPort  = 47808;

    CabinaProcessor();
    ~CabinaProcessor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout&) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override                          { return true; }

    const juce::String getName() const override              { return JucePlugin_Name; }
    bool acceptsMidi() const override                        { return false; }
    bool producesMidi() const override                       { return false; }
    bool isMidiEffect() const override                       { return false; }
    double getTailLengthSeconds() const override             { return 0.0; }

    int getNumPrograms() override                            { return 1; }
    int getCurrentProgram() override                         { return 0; }
    void setCurrentProgram (int) override                    {}
    const juce::String getProgramName (int) override         { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override   {}
    void setStateInformation (const void*, int) override     {}

    void updateTrackProperties (const TrackProperties&) override;

    // Para el editor
    int  getPort() const noexcept              { return server.getPort(); }
    int  getNumClients() const noexcept        { return server.getNumClients(); }
    juce::String getLastOrigin() const         { return server.getLastOrigin(); }
    bool isReceiving() const noexcept          { return ! buffering.load(); }
    float takePeak (int ch) noexcept           { return peak[ch].exchange (0.0f); }

private:
    juce::String helloMessage() override;
    void binaryReceived (const void* data, size_t size) override;
    void run() override; // hilo de envío (solo Send)

    void writeFrames (const float* interleaved, int frames);
    void writeFrames (const float* left, const float* right, int frames);
    void updatePeaks (const float* left, const float* right, int n) noexcept;

    WebSocketServer server { *this };

    std::atomic<double> sampleRate { 48000.0 };
    juce::String trackName;
    juce::CriticalSection nameLock;

    static constexpr int fifoFrames = 1 << 17; // ~2,7 s a 48 kHz
    juce::AbstractFifo fifo { fifoFrames };
    std::vector<float> ring;

    std::atomic<float> peak[2];
    std::atomic<bool> buffering { true };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CabinaProcessor)
};
