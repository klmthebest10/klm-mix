cmake_minimum_required(VERSION 3.15)
# klm-procaudio — tangkap suara PC kecuali KLM Mix (WASAPI process loopback, Windows 10 2004+). Lisensi MIT.
project(klm_procaudio CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>") # tanpa DLL runtime VC++
add_executable(klm-procaudio klm-procaudio.cpp)
target_compile_definitions(klm-procaudio PRIVATE _WIN32_WINNT=0x0A00 WINVER=0x0A00 UNICODE _UNICODE)
target_link_libraries(klm-procaudio mmdevapi ole32 ws2_32)
