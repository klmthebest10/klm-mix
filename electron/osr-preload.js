'use strict';
// Jembatan kecil untuk halaman overlay yang dirender offscreen oleh KLM Mix (mis. running text native).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('klmOsr', { post: (msg) => { try { ipcRenderer.send('osr:msg', msg); } catch (e) {} } });
