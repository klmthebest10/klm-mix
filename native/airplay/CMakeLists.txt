cmake_minimum_required(VERSION 3.13)
# klm-airplay — penerima AirPlay Mirroring untuk KLM Mix. Memakai pustaka AirPlay dari UxPlay (GPL-3.0) → program ini GPL-3.0.
#   git clone https://github.com/FDH2/UxPlay.git
#   cmake -S native/airplay -B native/airplay/build -DUXPLAY_DIR=<path UxPlay> -G Ninja && cmake --build native/airplay/build
# Butuh: OpenSSL (libcrypto) dan libplist-2.0. Di Windows dibangun dengan MSYS2 (UCRT64).
project(klm_airplay C)
set(UXPLAY_DIR "" CACHE PATH "Path sumber UxPlay")
if(NOT EXISTS "${UXPLAY_DIR}/lib/raop.h")
  message(FATAL_ERROR "UXPLAY_DIR tidak valid: ${UXPLAY_DIR}")
endif()
set(CMAKE_C_STANDARD 11)
set(NO_MARCH_NATIVE ON CACHE BOOL "" FORCE)   # biner harus jalan di semua PC, bukan hanya mesin build
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
add_subdirectory(${UXPLAY_DIR}/lib/mdnsd  ${CMAKE_BINARY_DIR}/mdnsd)    # mDNS bawaan: tidak perlu Bonjour
add_subdirectory(${UXPLAY_DIR}/lib/llhttp ${CMAKE_BINARY_DIR}/llhttp)
add_subdirectory(${UXPLAY_DIR}/lib/playfair ${CMAKE_BINARY_DIR}/playfair)
add_subdirectory(${UXPLAY_DIR}/lib ${CMAKE_BINARY_DIR}/airplay)
add_executable(klm-airplay klm-airplay.c)
target_include_directories(klm-airplay PRIVATE ${UXPLAY_DIR}/lib)
target_link_libraries(klm-airplay airplay)
if(WIN32)
  target_link_libraries(klm-airplay ws2_32 iphlpapi)
else()
  target_link_options(klm-airplay PRIVATE -Wl,--no-as-needed)
  set_property(TARGET klm-airplay APPEND PROPERTY LINK_LIBRARIES -Wl,--start-group airplay m -Wl,--end-group)
endif()
