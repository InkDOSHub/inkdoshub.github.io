/* One address: the Hub lives at the Cloudflare address, which sends the isolation headers that GitHub Pages
   cannot (needed by offline transcription and faster multi-core apps). Visits to inkdoshub.github.io go to the
   same page there. The Windows/Linux apps (window.inkHubNativo) and pages inside frames stay where they are. */
(function () {
  if (location.hostname !== "inkdoshub.github.io" || window.inkHubNativo || window.top !== window.self) return;
  location.replace("https://hub.inkdos.workers.dev" + location.pathname + location.search + location.hash);
})();
