/* pyodide-runner.js — run a kid's console Python game in the browser.
 *
 * Each `[data-pyplay]` block on the page is a self-contained player:
 *   - a row of move buttons whose `data-move` value is fed to the script's
 *     single `input()` call (so the original `int(input(...))` runs unchanged),
 *   - an output <pre> that shows whatever the script print()s,
 *   - a <details> holding the real source, read back via textContent.
 *
 * Pyodide (CPython compiled to WASM) is loaded lazily from the jsDelivr CDN
 * on the first move, and shared across every player on the page. The kid's
 * code is never modified — we only wire stdin/stdout around it.
 */
(function () {
  "use strict";

  var PYODIDE_VERSION = "0.26.4";
  var CDN = "https://cdn.jsdelivr.net/pyodide/v" + PYODIDE_VERSION + "/full/";

  // Shared, lazily-resolved Pyodide instance (one per page).
  var pyodidePromise = null;

  function loadRuntime(onProgress) {
    if (pyodidePromise) return pyodidePromise;
    pyodidePromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = CDN + "pyodide.js";
      s.onload = function () {
        if (onProgress) onProgress();
        window
          .loadPyodide({ indexURL: CDN })
          .then(resolve)
          .catch(reject);
      };
      s.onerror = function () {
        reject(new Error("Failed to load Pyodide from CDN"));
      };
      document.head.appendChild(s);
    });
    return pyodidePromise;
  }

  function t(zh, en) {
    // Pick language from the live toggle so status text matches the page.
    return document.body.classList.contains("show-en") ? en : zh;
  }

  function initPlayer(root) {
    var source = (root.querySelector("[data-pyplay-src]") || {}).textContent || "";
    var output = root.querySelector("[data-pyplay-output]");
    var status = root.querySelector("[data-pyplay-status]");
    var buttons = Array.prototype.slice.call(
      root.querySelectorAll(".pyplay-move")
    );

    var pendingInput = ""; // value handed to the script's input() this round
    var busy = false;

    function setStatus(msg) {
      if (status) status.textContent = msg;
    }
    function setButtonsEnabled(on) {
      buttons.forEach(function (b) {
        b.disabled = !on;
      });
    }

    function runRound(py, move) {
      pendingInput = String(move);
      var lines = [];

      py.setStdin({
        stdin: function () {
          var v = pendingInput;
          pendingInput = ""; // one line, then EOF for any further reads
          return v;
        },
      });
      py.setStdout({
        batched: function (str) {
          lines.push(str);
        },
      });

      try {
        py.runPython(source);
      } catch (err) {
        lines.push("⚠️ " + (err && err.message ? err.message : String(err)));
      }

      var text = lines.join("\n");
      output.textContent = text;
      // Tag the result so CSS can color the win/lose line.
      root.classList.remove("is-win", "is-lose");
      if (/you win/i.test(text)) root.classList.add("is-win");
      else if (/loser/i.test(text)) root.classList.add("is-lose");
    }

    function onMove(move) {
      if (busy) return;
      busy = true;
      setButtonsEnabled(false);

      var first = !pyodidePromise;
      if (first) {
        setStatus(
          t(
            "正在加载 Python（第一次需要几秒）…",
            "Loading Python (a few seconds the first time)…"
          )
        );
      }

      loadRuntime()
        .then(function (py) {
          setStatus("");
          runRound(py, move);
        })
        .catch(function (err) {
          setStatus(
            t("加载失败，请刷新重试。", "Failed to load. Please refresh and retry.")
          );
          if (window.console) console.error(err);
        })
        .then(function () {
          busy = false;
          setButtonsEnabled(true);
        });
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        onMove(b.getAttribute("data-move"));
      });
    });
  }

  function init() {
    var roots = document.querySelectorAll("[data-pyplay]");
    Array.prototype.forEach.call(roots, initPlayer);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
