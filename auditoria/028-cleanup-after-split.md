# 028 – Cleanup after the repository split

Date: 2026-11-14

The apps that moved to their own repositories (InkSoC, InkShell, InkCam, InkMind, InkArcade, InkBench) left a few leftovers in the Hub.

- `worker.js`: removed the Boxedwine network gateway (`/net/boxedwine`). Boxedwine left the Hub and nothing opened it. The wisp tunnel (`/net/wisp/`) is unchanged.
- `README.md`: the old v86 Linux terminal section (network, URL parameters, image rebuild) described code that is no longer here. It is now a short pointer to InkShell, which runs Alpine on InkSoC.

Same pass in the app repositories (one commit each on main): English identifiers and file names in InkArcade, InkMind (`download-worker.js`, `extract.js`), InkCam (`app.js`) and InkBench (`tabs.js`, `app.js`, `bench.js`); InkShell no longer tracks its build output (`engine-src/target`). Storage keys, DOM ids read by the Windows apps and native API names were kept, so saved data and the Windows apps keep working.

Still in Portuguese: the InkCam Windows receiver (`windows/*.cs`, `LEIA-ME.txt`), left for a later pass because it can only be checked by the Windows build.
