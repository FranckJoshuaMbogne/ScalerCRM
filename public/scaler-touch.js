/*!
 * SCALER website tracking. Remembers how a visitor arrived (UTM tags, gclid,
 * fbclid, landing page, referrer) for 90 days in a first-party cookie, fills
 * hidden scaler_* fields in forms, and exposes window.scalerTouch() for the
 * lead API. No third-party requests; nothing is sent anywhere by this script.
 */
(function () {
  var KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid"];
  var FIRST = "scaler_ft";
  var LAST = "scaler_lt";
  var DAYS = 90;

  function read(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  }
  function write(name, value) {
    var expires = new Date(Date.now() + DAYS * 864e5).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(JSON.stringify(value)) + "; expires=" + expires + "; path=/; SameSite=Lax";
  }

  var params = new URLSearchParams(window.location.search);
  var current = {};
  var hasClick = false;
  KEYS.forEach(function (k) {
    var v = params.get(k);
    if (v) { current[k] = v.slice(0, 200); hasClick = true; }
  });
  if (hasClick || !read(LAST)) {
    current.page_url = (window.location.origin + window.location.pathname).slice(0, 500);
    if (document.referrer && document.referrer.indexOf(window.location.host) === -1) current.referrer = document.referrer.slice(0, 500);
    if (!read(FIRST)) write(FIRST, current);
    write(LAST, current);
  }

  /** The touch to send with a lead: the latest visit with campaign data. */
  window.scalerTouch = function () {
    return read(LAST) || {};
  };
  window.scalerFirstTouch = function () {
    return read(FIRST) || {};
  };

  function fill() {
    var touch = window.scalerTouch();
    var forms = document.querySelectorAll("form");
    for (var i = 0; i < forms.length; i++) {
      for (var key in touch) {
        var name = "scaler_" + key;
        var input = forms[i].querySelector('input[name="' + name + '"]');
        if (!input) {
          input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          forms[i].appendChild(input);
        }
        input.value = touch[key];
      }
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill);
  else fill();
})();
