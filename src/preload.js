const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  setNote: (key, note) => ipcRenderer.invoke('notes:set', { key, note }),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (json) => ipcRenderer.invoke('data:import', json),
  detectSync: () => ipcRenderer.invoke('sync:detect'),
  pickSyncFolder: () => ipcRenderer.invoke('sync:pickFolder'),
  fbSignIn: (email, password) => ipcRenderer.invoke('fb:signIn', { email, password }),
  fbSignUp: (email, password) => ipcRenderer.invoke('fb:signUp', { email, password }),
  fbSignOut: () => ipcRenderer.invoke('fb:signOut'),
  fbState: () => ipcRenderer.invoke('fb:state'),
  fbInfo: () => ipcRenderer.invoke('fb:info'),
  onAuthState: (cb) => ipcRenderer.on('auth:state', (_e, s) => cb(s)),
  onSyncStatus: (cb) => ipcRenderer.on('sync:status', (_e, t) => cb(t)),
  minimize: () => ipcRenderer.send('win:minimize'),
  hide: () => ipcRenderer.send('win:hide'),
  quit: () => ipcRenderer.send('win:quit'),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),
  onNotesChanged: (cb) => ipcRenderer.on('notes:changed', (_e, n) => cb(n))
});
