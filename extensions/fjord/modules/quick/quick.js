// Popup-window version of the quick find box (used where a content script cannot run).
import { mountQuick } from "./ui.js";

const close = () => window.close();
mountQuick(document.getElementById("app"), { close, inPage: false });
if (!location.hash.includes("keep")) window.addEventListener("blur", () => setTimeout(close, 200)); // like a menu: clicking elsewhere dismisses it (#keep: tests)
