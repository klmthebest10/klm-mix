cmake_minimum_required(VERSION 3.19)
# KLM Mix — helper host plugin VST3/VST2 (klm-vsthost) + plugin uji
# cmake -B build -DVST3_SDK=<path vst3sdk v3.8.x> && cmake --build build --config Release

if(WIN32)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
project(klm_vsthost LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(VST3_SDK "" CACHE PATH "Path ke VST 3 SDK (github.com/steinbergmedia/vst3sdk)")
if(NOT EXISTS "${VST3_SDK}/pluginterfaces")
  message(FATAL_ERROR "VST3_SDK tidak valid: ${VST3_SDK}")
endif()
option(KLM_BUILD_TESTPLUGIN "Bangun plugin uji KLM Test Gain" ON)

set(SDK_ROOT "${VST3_SDK}")
set(SMTG_USE_STATIC_CRT ON CACHE BOOL "" FORCE)
set(SMTG_CREATE_PLUGIN_LINK OFF CACHE BOOL "" FORCE)
set(SMTG_RUN_VST_VALIDATOR OFF CACHE BOOL "" FORCE)
set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
set(SMTG_ADD_VSTGUI OFF CACHE BOOL "" FORCE)
list(APPEND CMAKE_MODULE_PATH "${VST3_SDK}/cmake/modules")
include(SMTG_VST3_SDK)
smtg_setup_platform_toolset()
set(public_sdk_SOURCE_DIR "${VST3_SDK}/public.sdk")

smtg_create_lib_base_target()
smtg_create_pluginterfaces_target()
smtg_create_public_sdk_common_target()
smtg_create_public_sdk_target()
smtg_create_public_sdk_hosting_target()

set(HOST_SRC
  src/main.cpp src/vst3.cpp src/vst2.cpp src/plug.h
  ${VST3_SDK}/public.sdk/source/vst/hosting/plugprovider.cpp
  ${VST3_SDK}/public.sdk/source/common/memorystream.cpp
)
if(WIN32)
  list(APPEND HOST_SRC ${VST3_SDK}/public.sdk/source/vst/hosting/module_win32.cpp)
elseif(APPLE)
  list(APPEND HOST_SRC ${VST3_SDK}/public.sdk/source/vst/hosting/module_mac.mm)
else()
  list(APPEND HOST_SRC ${VST3_SDK}/public.sdk/source/vst/hosting/module_linux.cpp)
endif()

add_executable(klm-vsthost ${HOST_SRC})
target_link_libraries(klm-vsthost PRIVATE sdk_hosting)
if(WIN32)
  target_link_libraries(klm-vsthost PRIVATE ole32 user32 shell32 gdi32)
  target_compile_definitions(klm-vsthost PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
  # subsistem GUI (tanpa jendela konsol), tetap memakai main() & pipe stdin/stdout dari Electron
  set_target_properties(klm-vsthost PROPERTIES WIN32_EXECUTABLE ON)
  if(MSVC)
    target_link_options(klm-vsthost PRIVATE /ENTRY:mainCRTStartup)
  endif()
else()
  find_package(Threads REQUIRED)
  target_link_libraries(klm-vsthost PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
endif()

if(KLM_BUILD_TESTPLUGIN)
  set(TP_SRC test/testgain.cpp ${VST3_SDK}/public.sdk/source/vst/vstsinglecomponenteffect.cpp)
  if(WIN32)
    list(APPEND TP_SRC ${VST3_SDK}/public.sdk/source/main/dllmain.cpp)
    set(TP_ARCH "x86_64-win")
    set(TP_SUFFIX ".vst3")
  else()
    list(APPEND TP_SRC ${VST3_SDK}/public.sdk/source/main/linuxmain.cpp)
    set(TP_ARCH "${CMAKE_SYSTEM_PROCESSOR}-linux")
    set(TP_SUFFIX ".so")
  endif()
  add_library(klm-testgain MODULE ${TP_SRC})
  target_link_libraries(klm-testgain PRIVATE sdk)
  set(TP_DIR "${CMAKE_BINARY_DIR}/KLMTestGain.vst3/Contents/${TP_ARCH}")
  set_target_properties(klm-testgain PROPERTIES
    OUTPUT_NAME "KLMTestGain" PREFIX "" SUFFIX "${TP_SUFFIX}"
    LIBRARY_OUTPUT_DIRECTORY "${TP_DIR}"
    LIBRARY_OUTPUT_DIRECTORY_RELEASE "${TP_DIR}"
    LIBRARY_OUTPUT_DIRECTORY_DEBUG "${TP_DIR}")
endif()
