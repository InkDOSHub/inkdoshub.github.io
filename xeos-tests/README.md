# XeOS tests

Reports from the "XeOS tests" app (`apps/xeos-tests/`, open at https://inkdoshub.github.io/apps/xeos-tests/).

1. Open the app inside XeOS and tap "Run tests", then the extra buttons.
2. "Download report" saves `xeos-NNN-YYYY-MM-DD.json` (NNN counts up on each device).
3. "Upload to GitHub" opens `xeos-tests/results/`: drop the file there and commit.

Each run is compared with the previous ones to see what XeOS supports and how the apps should integrate with it. `suite` in the JSON is the test version: it goes up when tests change.
