#!/usr/bin/env python3
"""Build a local Chrome 76 syntax/API/focus compatibility trial from the WGT.

Skips the old-TV warning at the user's request; retains startup-error reporting.
Does not change TV/system settings.
Dependencies: npm ci in this compatibility directory (esbuild, core-js, acorn).
"""
import hashlib
import json
import re
from pathlib import Path
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "downloads/aiostreams-tizen.wgt"
OUTPUT = ROOT / "downloads/aiostreams-tizen-chrome76.wgt"
MODULES = ROOT / "node_modules"
ESBUILD = MODULES / "esbuild/bin/esbuild"
EXPECTED = "766f6de50e291ef800cce4e65f5374acab94cd3d7cb0b30ec4945ef824bc729c"


def check_syntax(data, name):
    subprocess.run(
        ["node", "-e", "const fs=require('node:fs');"
         "const acorn=require(process.argv[1]);"
         "acorn.parse(fs.readFileSync(0,'utf8'),{ecmaVersion:2019});",
         str(MODULES / "acorn")],
        input=data, check=True, capture_output=True,
    )
    return {"file": name, "bytes": len(data), "es2019_parse": "pass"}


def main():
    if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != EXPECTED:
        raise SystemExit("Input widget differs from the inspected official release")
    common = [str(ESBUILD), "--target=chrome76", "--minify", "--log-level=warning"]
    polyfills = subprocess.run(
        [*common, str(MODULES / "core-js/stable/index.js"), "--bundle", "--format=iife"],
        check=True, capture_output=True,
    ).stdout
    report = [check_syntax(polyfills, "compat-polyfills.js")]
    with zipfile.ZipFile(SOURCE) as original:
        files = {name: original.read(name) for name in original.namelist()
                 if not name.endswith("/")}
    # The app calls matches() with this unsupported pseudo-class while handling
    # remote keys and choosing the first source. CSS-only focus fixes cannot
    # prevent the resulting SyntaxError. Limit the patch to these two calls.
    entry = "static/js/index.5d6be1da.js"
    main_js = files[entry].decode()
    if main_js.count('.matches(":focus-visible")') != 2:
        raise SystemExit("Focus call sites changed; review before patching")
    files[entry] = main_js.replace('.matches(":focus-visible")', '.matches(":focus")').encode()
    boot = files['boot.js'].decode()
    if boot.count('if (old)') != 1:
        raise SystemExit("Startup warning changed; review before patching")
    files['boot.js'] = boot.replace('if (old)', 'if (false)').encode()
    # Each existing webpack chunk keeps its filename and registration behavior.
    for name, data in list(files.items()):
        if name.endswith(".js"):
            transformed = subprocess.run(
                common, input=data, check=True, capture_output=True,
            ).stdout
            report.append(check_syntax(transformed, name))
            files[name] = transformed
    files["compat-polyfills.js"] = polyfills
    files["core-js-LICENSE.txt"] = (MODULES / "core-js/LICENSE").read_bytes()
    # max() is unsupported on Chrome 76. On a rectangular TV the safe-area
    # insets are zero; retain the ordinary padding before the modern rule.
    css_entry = 'static/css/index.4d26eacb.css'
    base_css, padding_count = re.subn(
        r'(padding-(?:top|right|bottom|left)):max\(([\d.]+rem),env\(safe-area-inset-(?:top|right|bottom|left)\)\)',
        lambda m: m[1] + ':' + m[2] + ';' + m[0], files[css_entry].decode())
    if padding_count != 6:
        raise SystemExit('Safe-area padding rules changed; review before patching')
    files[css_entry] = base_css.encode()
    html = files["index.html"].decode()
    if html.count('class="dark"') != 1:
        raise SystemExit("Unexpected HTML root; review before patching")
    html = html.replace('class="dark"', 'class="dark compat-chrome76"')
    if html.count('<script src="boot.js"></script>') != 1:
        raise SystemExit("Unexpected HTML bootstrap; review before patching")
    html = html.replace(
        '<script src="boot.js"></script>',
        '<script src="boot.js"></script><script src="compat-polyfills.js"></script>',
    )
    css = (ROOT / "scripts/aiostreams_legacy_focus.css").read_bytes()
    css_name = 'legacy-ui.' + hashlib.sha256(css).hexdigest()[:12] + '.css'
    files[css_name] = css
    files["index.html"] = html.replace(
        '</head>', '<link rel="stylesheet" href="' + css_name + '"></head>',
    ).encode()
    # Entry, boot and base CSS are referenced from HTML, not the webpack chunk map.
    # Content-derived names prevent stale code/styles on same-version updates.
    for old_name in ('boot.js', entry, css_entry):
        stem, suffix = old_name.rsplit('.', 1)
        new_name = stem + '.compat-' + hashlib.sha256(files[old_name]).hexdigest()[:12] + '.' + suffix
        files[new_name] = files.pop(old_name)
        files['index.html'] = files['index.html'].replace(old_name.encode(), new_name.encode())
    files["compat-build.json"] = json.dumps({
        "base_version": "0.3.1", "target": "chrome76",
        "kind": "local compatibility trial", "source_sha256": EXPECTED,
        "esbuild": "0.25.12", "core_js": "3.46.0",
        "focus_fix": "Static high-contrast :focus fallback for Chromium 76",
        "runtime_focus_fix": "Replace two unsupported Element.matches(:focus-visible) calls",
        "route_visibility_fix": "Hide retained inactive Home with visibility fallback for content-visibility",
        "artwork_size_fix": "Reserve poster, square and landscape card height without aspect-ratio",
        "spacing_fix": "Margins for known flex components; six safe-area padding fallbacks before max()",
        "startup_warning": "Skipped at user request; startup error overlay retained",
        "asset_cache": "Changed entry, boot, base and override CSS use content-derived filenames",
        "limits": "Does not establish full layout or runtime compatibility",
    }, indent=2).encode()
    with zipfile.ZipFile(OUTPUT, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name, data in files.items():
            entry = zipfile.ZipInfo(name, date_time=(2026, 10, 12, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(entry, data)
    print(json.dumps({"output": str(OUTPUT),
                      "sha256": hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
                      "syntax_checks": report}, indent=2))


if __name__ == "__main__":
    main()
