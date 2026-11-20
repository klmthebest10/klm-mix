cmake_minimum_required(VERSION 3.15)
# klm-engine — mesin video native KLM (Direct3D 11): monitor Preview & Program dirender GPU di jendela anak
# yang ditempel di atas jendela KLM. Fase 1 (eksperimen). Lisensi: milik KLM.
project(klm_engine CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>") # tanpa DLL runtime VC++
add_executable(klm-engine klm-engine.cpp)
target_compile_definitions(klm-engine PRIVATE _WIN32_WINNT=0x0A00 WINVER=0x0A00 UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
if(MSVC)
  target_compile_options(klm-engine PRIVATE /W3 /utf-8 /O2)
endif()
target_link_libraries(klm-engine d3d11 dxgi d3dcompiler user32 gdi32 psapi winmm ole32 mfplat mf mfreadwrite mfuuid wmcodecdspuuid)
