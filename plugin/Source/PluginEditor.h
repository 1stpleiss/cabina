#pragma once

#include "PluginProcessor.h"

class CabinaEditor : public juce::AudioProcessorEditor,
                     private juce::Timer
{
public:
    explicit CabinaEditor (CabinaProcessor&);
    ~CabinaEditor() override = default;

    void paint (juce::Graphics&) override;

private:
    void timerCallback() override;

    CabinaProcessor& proc;
    float level[2] { 0.0f, 0.0f };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (CabinaEditor)
};
