/* One address: the Hub lives at the Cloudflare address, which sends the isolation headers that GitHub Pages
   cannot (needed by offline transcription and faster multi-core apps). Visits to inkdoshub.github.io go to the
   same page there. The Windows/Linux apps (window.inkHubNativo) and pages inside frames stay where they are. */
(function () {
  /* Development: ?dev=1 keeps this browser on GitHub Pages (newest version, for tests); ?dev=0 undoes it. */
  try {
    var m = /[?&]dev=([01])/.exec(location.search);
    if (m) { if (m[1] === "1") localStorage.setItem("inkdoshub-dev", "1"); else localStorage.removeItem("inkdoshub-dev"); }
    if (localStorage.getItem("inkdoshub-dev") === "1") return;
  } catch (e) {}
  if (location.hostname !== "inkdoshub.github.io" || window.inkHubNativo || window.top !== window.self) return;
  location.replace("https://hub.inkdos.workers.dev" + location.pathname + location.search + location.hash);
})();
