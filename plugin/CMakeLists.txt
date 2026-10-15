cmake_minimum_required(VERSION 3.22)
project(Cabina VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Copiar los plugins a la carpeta del sistema al compilar (desactivado en GitHub Actions)
option(CABINA_COPY_AFTER_BUILD "Copiar los plugins a la carpeta de plugins del sistema" ON)

include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.9
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(JUCE)

set(CABINA_FORMATS VST3)
if(APPLE)
    list(APPEND CABINA_FORMATS AU)
endif()

# Un mismo código fuente genera dos plugins: Send (máster → web) y Retorno (web → pista)
function(cabina_plugin target product_name plugin_code is_return)
    juce_add_plugin(${target}
        COMPANY_NAME                "Cabina"
        BUNDLE_ID                   "com.cabina.${target}"
        PLUGIN_MANUFACTURER_CODE    Cbna
        PLUGIN_CODE                 ${plugin_code}
        FORMATS                     ${CABINA_FORMATS}
        PRODUCT_NAME                "${product_name}"
        IS_SYNTH                    FALSE
        NEEDS_MIDI_INPUT            FALSE
        NEEDS_MIDI_OUTPUT           FALSE
        IS_MIDI_EFFECT              FALSE
        EDITOR_WANTS_KEYBOARD_FOCUS FALSE
        VST3_CATEGORIES             Fx Tools
        AU_MAIN_TYPE                kAudioUnitType_Effect
        COPY_PLUGIN_AFTER_BUILD     ${CABINA_COPY_AFTER_BUILD})

    target_sources(${target} PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
        Source/WebSocketServer.cpp)

    target_compile_definitions(${target} PUBLIC
        CABINA_RETURN=${is_return}
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0)

    target_link_libraries(${target}
        PRIVATE
            juce::juce_audio_utils
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_lto_flags
            juce::juce_recommended_warning_flags)
endfunction()

cabina_plugin(CabinaSend   "Cabina Send"    CbSd 0)
cabina_plugin(CabinaReturn "Cabina Retorno" CbRt 1)
