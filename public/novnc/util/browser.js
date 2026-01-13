"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true,
});
exports.hasScrollbarGutter = exports.dragThreshold = void 0;
exports.isAndroid = isAndroid;
exports.isBlink = isBlink;
exports.isChrome = isChrome;
exports.isChromeOS = isChromeOS;
exports.isChromium = isChromium;
exports.isEdge = isEdge;
exports.isFirefox = isFirefox;
exports.isGecko = isGecko;
exports.isIOS = isIOS;
exports.isMac = isMac;
exports.isOpera = isOpera;
exports.isSafari = isSafari;
exports.isTouchDevice = void 0;
exports.isWebKit = isWebKit;
exports.isWindows = isWindows;
exports.supportsWebCodecsH264Decode = exports.supportsCursorURIs = void 0;
var Log = _interopRequireWildcard(require("./logging.js"));
var _base = _interopRequireDefault(require("../base64.js"));
function _interopRequireDefault(e) {
  return e && e.__esModule ? e : { default: e };
}
function _getRequireWildcardCache(e) {
  if (typeof WeakMap !== "function") return null;
  var r = new WeakMap(),
    t = new WeakMap();
  return (_getRequireWildcardCache = function _getRequireWildcardCache(e) {
    return e ? t : r;
  })(e);
}
function _interopRequireWildcard(e, r) {
  if (!r && e && e.__esModule) return e;
  if (e === null || (typeof e !== "object" && typeof e !== "function")) {
    return { default: e };
  }
  var t = _getRequireWildcardCache(r);
  if (t && t.has(e)) return t.get(e);
  var n = { __proto__: null },
    a = Object.defineProperty && Object.getOwnPropertyDescriptor;
  for (var u in e)
    if (u !== "default" && Object.prototype.hasOwnProperty.call(e, u)) {
      var i = a ? Object.getOwnPropertyDescriptor(e, u) : null;
      if (i && (i.get || i.set)) {
        Object.defineProperty(n, u, i);
      } else {
        n[u] = e[u];
      }
    }
  n.default = e;
  if (t) t.set(e, n);
  return n;
}
function _typeof(o) {
  return (
    (typeof Symbol === "function" && typeof Symbol.iterator === "symbol"
      ? typeof o
      : o && typeof Symbol === "function" && o.constructor === Symbol && o !== Symbol.prototype
        ? "symbol"
        : typeof o)
  );
}

// Touch detection
var isTouchDevice =
  "ontouchstart" in document.documentElement ||
  document.ontouchstart !== undefined ||
  navigator.maxTouchPoints > 0 ||
  navigator.msMaxTouchPoints > 0;
exports.isTouchDevice = isTouchDevice;
window.addEventListener(
  "touchstart",
  function onFirstTouch() {
    exports.isTouchDevice = isTouchDevice = true;
    window.removeEventListener("touchstart", onFirstTouch, false);
  },
  false,
);

// The goal is to find a certain physical width, the devicePixelRatio
// brings us a bit closer but is not optimal.
var dragThreshold = (exports.dragThreshold = 10 * (window.devicePixelRatio || 1));
var _supportsCursorURIs = false;
try {
  var target = document.createElement("canvas");
  target.style.cursor =
    'url("data:image/x-icon;base64,AAACAAEACAgAAAIAAgA4AQAAFgAAACgAAAAIAAAAEAAAAAEAIAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////AAAAAAAAAAAAAAAAAAAAAA==") 2 2, default';
  if (target.style.cursor.indexOf("url") === 0) {
    Log.Info("Data URI scheme cursor supported");
    _supportsCursorURIs = true;
  } else {
    Log.Warn("Data URI scheme cursor not supported");
  }
} catch (exc) {
  Log.Error("Data URI scheme cursor test exception: " + exc);
}
var supportsCursorURIs = (exports.supportsCursorURIs = _supportsCursorURIs);
var _hasScrollbarGutter = true;
try {
  // Create invisible container
  var container = document.createElement("div");
  container.style.visibility = "hidden";
  container.style.overflow = "scroll"; // forcing scrollbars
  document.body.appendChild(container);

  // Create a div and place it in the container
  var child = document.createElement("div");
  container.appendChild(child);

  // Calculate the difference between the container's full width
  // and the child's width - the difference is the scrollbars
  var scrollbarWidth = container.offsetWidth - child.offsetWidth;

  // Clean up
  container.parentNode.removeChild(container);
  _hasScrollbarGutter = scrollbarWidth != 0;
} catch (exc) {
  Log.Error("Scrollbar test exception: " + exc);
}
var hasScrollbarGutter = (exports.hasScrollbarGutter = _hasScrollbarGutter);

// H264 decode support: disable auto-check to avoid top-level await.
var supportsWebCodecsH264Decode = (exports.supportsWebCodecsH264Decode = false);

function isMac() {
  return navigator && /mac/i.test(navigator.platform);
}
function isWindows() {
  return navigator && /win/i.test(navigator.platform);
}
function isIOS() {
  return navigator && /ipad|iphone|ipod/i.test(navigator.platform);
}
function isAndroid() {
  return navigator && /android/i.test(navigator.userAgent);
}
function isChromeOS() {
  return navigator && /cros/i.test(navigator.userAgent);
}
function isFirefox() {
  return navigator && /firefox/i.test(navigator.userAgent);
}
function isOpera() {
  return navigator && /opera|opr/i.test(navigator.userAgent);
}
function isIE() {
  return (
    navigator &&
    (/trident.*rv\\:11\\.0/i.test(navigator.userAgent) ||
      /msie/i.test(navigator.userAgent))
  );
}
function isEdge() {
  return navigator && /edg/i.test(navigator.userAgent);
}
function isChrome() {
  return (
    navigator &&
    /chrome/i.test(navigator.userAgent) &&
    !isEdge() &&
    !isOpera() &&
    !!window.chrome
  );
}
function isChromium() {
  return navigator && /chromium/i.test(navigator.userAgent);
}
function isWebKit() {
  return navigator && /applewebkit/i.test(navigator.userAgent);
}
function isBlink() {
  return (isChrome() || isOpera()) && !!window.CSS;
}
function isGecko() {
  return navigator && /gecko/i.test(navigator.userAgent) && !isWebKit();
}
function isSafari() {
  return isWebKit() && navigator && /safari/i.test(navigator.userAgent) && !isChrome();
}

exports.isMac = isMac;
exports.isWindows = isWindows;
exports.isIOS = isIOS;
exports.isAndroid = isAndroid;
exports.isChromeOS = isChromeOS;
exports.isFirefox = isFirefox;
exports.isOpera = isOpera;
exports.isIE = isIE;
exports.isEdge = isEdge;
exports.isChrome = isChrome;
exports.isChromium = isChromium;
exports.isWebKit = isWebKit;
exports.isBlink = isBlink;
exports.isGecko = isGecko;
exports.isSafari = isSafari;
exports.dragThreshold = dragThreshold;
exports.supportsCursorURIs = supportsCursorURIs;
exports.hasScrollbarGutter = hasScrollbarGutter;
exports.supportsWebCodecsH264Decode = supportsWebCodecsH264Decode;
