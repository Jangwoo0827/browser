// Exposes the browser command API to Fjord's own pages (fjord://...). Websites get nothing.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "fjord:") {
  contextBridge.exposeInMainWorld("fjord", {
    cmd: (name, arg) => ipcRenderer.invoke("cmd", name, arg),
    on: (channel, cb) => {
      const handler = (_event, data) => cb(data);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
  });
}
