#include "PluginEditor.h"

namespace colours
{
    const juce::Colour bg     { 0xff0d0e10 };
    const juce::Colour panel  { 0xff16181b };
    const juce::Colour line   { 0xff2a2e34 };
    const juce::Colour text   { 0xffebe8e3 };
    const juce::Colour muted  { 0xff8d929a };
    const juce::Colour accent { 0xfff2a33a };
    const juce::Colour red    { 0xffe5484d };
    const juce::Colour green  { 0xff3ecf8e };
}

CabinaEditor::CabinaEditor (CabinaProcessor& p)
    : juce::AudioProcessorEditor (p), proc (p)
{
    setSize (400, 190);
    startTimerHz (30);
}

void CabinaEditor::timerCallback()
{
    for (int ch = 0; ch < 2; ++ch)
        level[ch] = juce::jmax (proc.takePeak (ch), level[ch] * 0.85f);
    repaint();
}

void CabinaEditor::paint (juce::Graphics& g)
{
    using namespace colours;
    g.fillAll (bg);

    auto area = getLocalBounds().reduced (16);

    // Cabecera
    auto head = area.removeFromTop (26);
    const bool connected = proc.getNumClients() > 0;
    g.setColour (connected ? red : line);
    g.fillEllipse (head.removeFromLeft (12).withSizeKeepingCentre (12, 12).toFloat());
    head.removeFromLeft (10);
    g.setColour (text);
    g.setFont (juce::FontOptions (18.0f, juce::Font::bold));
    g.drawText (CabinaProcessor::isReturn ? "Cabina Retorno" : "Cabina Send", head, juce::Justification::centredLeft);

    g.setColour (muted);
    g.setFont (juce::FontOptions (12.5f));
    const auto port = proc.getPort();
    g.drawText (port > 0 ? "127.0.0.1:" + juce::String (port) : juce::String ("sin puerto"),
                head, juce::Justification::centredRight);

    area.removeFromTop (12);

    // Estado
    juce::String status, detail;
    if (port < 0)
    {
        status = "Puerto ocupado";
        detail = CabinaProcessor::isReturn ? "Hay ya 8 retornos abiertos. Se conectara solo cuando se libere uno."
                                           : "Hay otro Cabina Send abierto. Se conectara solo cuando se cierre.";
    }
    else if (! connected)
    {
        status = "Esperando a la web de Cabina";
        detail = CabinaProcessor::isReturn ? "En la web: \"Buscar retornos\" y elige quien llega aqui."
                                           : "En la web, en \"Tu DAW\", elige \"Plugin Cabina Send\".";
    }
    else
    {
        status = CabinaProcessor::isReturn ? (proc.isReceiving() ? "Recibiendo audio" : "Conectado, sin audio")
                                           : "Emitiendo";
        detail = "Conectado desde " + proc.getLastOrigin();
    }

    g.setColour (connected ? green : accent);
    g.setFont (juce::FontOptions (14.0f, juce::Font::bold));
    g.drawText (status, area.removeFromTop (20), juce::Justification::centredLeft);
    g.setColour (muted);
    g.setFont (juce::FontOptions (12.5f));
    g.drawFittedText (detail, area.removeFromTop (34), juce::Justification::topLeft, 2);

    area.removeFromTop (8);

    // Medidores L/R (pico, -60..0 dBFS)
    for (int ch = 0; ch < 2; ++ch)
    {
        auto row = area.removeFromTop (10);
        g.setColour (muted);
        g.setFont (juce::FontOptions (10.0f));
        g.drawText (ch == 0 ? "L" : "R", row.removeFromLeft (14), juce::Justification::centredLeft);

        auto bar = row.toFloat();
        g.setColour (panel);
        g.fillRoundedRectangle (bar, 3.0f);

        const float db = juce::Decibels::gainToDecibels (level[ch], -90.0f);
        const float v = juce::jlimit (0.0f, 1.0f, (db + 60.0f) / 60.0f);
        auto filled = bar.withWidth (bar.getWidth() * v);
        juce::ColourGradient grad (green, bar.getX(), 0, red, bar.getRight(), 0, false);
        grad.addColour (0.7, green);
        grad.addColour (0.85, accent);
        g.setGradientFill (grad);
        g.fillRoundedRectangle (filled, 3.0f);

        area.removeFromTop (5);
    }
}
