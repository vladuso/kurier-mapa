// Jednoduchý service worker: umožní pridať appku na plochu.
// Stránky a dáta sa vždy berú zo siete, aby kuriér videl aktuálnu verziu.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
