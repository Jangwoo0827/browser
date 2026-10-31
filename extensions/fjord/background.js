// One service worker for every module. Each module registers its own listeners at load time.
// Modules must keep their chrome.runtime.onMessage handlers to their own message types (workspaces: "ws:*",
// ad blocker: stat/update/resetStats/isUpdating).
import "./modules/sidebar/background.js";
import "./modules/workspaces/background.js";
import "./modules/newtab/background.js";
import "./modules/adblock/background.js";
import "./modules/claude/background.js";
import "./modules/rail/background.js";
import "./modules/quick/background.js";
