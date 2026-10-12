import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]

class CompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.source = zipfile.ZipFile(ROOT / 'downloads/aiostreams-tizen.wgt')
        self.build = zipfile.ZipFile(ROOT / 'downloads/aiostreams-tizen-chrome76.wgt')
        self.addCleanup(self.source.close)
        self.addCleanup(self.build.close)

    def test_legacy_focus_helper_no_longer_throws(self):
        original = self.source.read('static/js/index.5d6be1da.js').decode()
        helper = re.search(r'function tR\(\)\{.*?\}', original).group()
        patched = helper.replace('.matches(":focus-visible")', '.matches(":focus")')
        main = next(n for n in self.build.namelist() if n.startswith('static/js/index.') and '.compat-' in n)
        self.assertNotIn('.matches(":focus-visible")', self.build.read(main).decode())
        script = '''const vm=require('node:vm');const assert=require('node:assert');
        class HTMLElement { matches(selector) { if(selector===':focus') return true; throw new SyntaxError('Unsupported selector'); } }
        const active=new HTMLElement();const ctx={HTMLElement,document:{activeElement:active,body:{},documentElement:{hasAttribute:()=>false}},tE:'data-pointer-focus'};
        vm.createContext(ctx);
        vm.runInContext(ORIGINAL,ctx);
        assert.throws(()=>vm.runInContext('tR()',ctx), SyntaxError);
        vm.runInContext(PATCHED,ctx);
        assert.strictEqual(vm.runInContext('tR()',ctx),active);
        '''.replace('ORIGINAL', json.dumps(helper)).replace('PATCHED', json.dumps(patched))
        subprocess.run(['node','-e',script],check=True,capture_output=True)

    def test_warning_skipped_but_error_reporting_retained(self):
        name=next(n for n in self.build.namelist() if n.startswith('boot.compat-'))
        boot=self.build.read(name).decode()
        self.assertNotIn('This TV is too old',boot)
        self.assertIn('The app could not start',boot)
        script='''const vm=require('node:vm');const assert=require('node:assert');
        const events=[];const dom=[];
        vm.runInNewContext(BOOT,{navigator:{userAgent:'Tizen 6.0 Chrome/76.0'},window:{addEventListener:(n)=>events.push(n)},document:{addEventListener:(n)=>dom.push(n)}});
        assert(events.includes('error'));assert(events.includes('unhandledrejection'));
        assert(!dom.includes('DOMContentLoaded'));
        '''.replace('BOOT',json.dumps(boot))
        subprocess.run(['node','-e',script],check=True,capture_output=True)

    def test_changed_assets_are_referenced_and_playback_chunks_unchanged(self):
        html=self.build.read('index.html').decode()
        original_html=self.source.read('index.html').decode()
        original_missing={name for name in re.findall(r'(?:src|href)="([^"]+)"',original_html)
                          if name.removeprefix('./') not in self.source.namelist()}
        for name in re.findall(r'(?:src|href)="([^"]+)"',html):
            # Upstream references an absent PWA manifest and the TV's WEBAPIS script.
            if name in original_missing:
                continue
            self.assertIn(name.removeprefix('./'),self.build.namelist())
        self.assertIn('legacy-ui.',html)
        self.assertNotIn('src="boot.js"',html)
        old=self.source
        for name in old.namelist():
            if name.endswith('.js') and name not in ['boot.js','static/js/index.5d6be1da.js']:
                expected=subprocess.run([str(ROOT/'node_modules/esbuild/bin/esbuild'),
                    '--target=chrome76','--minify','--log-level=warning'],
                    input=old.read(name),check=True,capture_output=True).stdout
                self.assertEqual(expected,self.build.read(name),name)

    def test_retained_home_is_hidden_and_restored(self):
        css_name=next(n for n in self.build.namelist() if n.startswith('legacy-ui.'))
        css=self.build.read(css_name).decode()
        # Model the retained route without content-visibility or inert support.
        # A positioned Home child deliberately paints above the details page.
        html='''<!doctype html><html class="compat-chrome76"><head><style>
        body {margin:0} #home,#details {position:absolute;top:0;left:0;width:300px;height:200px}
        #home {overflow:auto} #catalog {position:relative;z-index:10;height:600px;background:red;visibility:visible}
        #details {background:blue}
        </style></head><body><div id="home" data-page="home" class="[content-visibility:hidden]">
        <div id="catalog"><button id="homeButton">Home item</button></div></div>
        <div id="details" data-page="item"><button id="detailsButton">Play</button></div>
        <script>
        const check=(value,message)=>{if(!value)throw Error(message)};
        try {
          const home=document.getElementById('home'),catalog=document.getElementById('catalog');
          check(document.elementFromPoint(100,100)===catalog,'fixture must reproduce catalog overlap');
          home.scrollTop=40;
          const style=document.createElement('style'); style.textContent=CSS; document.head.append(style);
          check(document.elementFromPoint(100,100).id==='details','inactive catalog still paints');
          check(getComputedStyle(catalog).visibility==='hidden','descendant visibility overrides fallback');
          document.getElementById('detailsButton').focus(); document.getElementById('homeButton').focus();
          check(document.activeElement.id==='detailsButton','hidden home steals focus');
          check(home.offsetHeight===200 && home.scrollTop===40,'cached layout/scroll changed');
          home.className=''; document.getElementById('details').remove();
          check(getComputedStyle(catalog).visibility==='visible','home did not restore');
          check(document.elementFromPoint(100,100)===catalog && home.scrollTop===40,'home state lost');
          document.body.textContent='ROUTE_VISIBILITY_PASS';
        } catch(error) {document.body.textContent='FAIL: '+error.message}
        </script></body></html>'''.replace('style.textContent=CSS;', 'style.textContent='+json.dumps(css)+';')
        self.run_browser_fixture(html, 'ROUTE_VISIBILITY_PASS')

    def test_artwork_dimensions_and_flex_spacing(self):
        css_name=next(n for n in self.build.namelist() if n.startswith('legacy-ui.'))
        css=self.build.read(css_name).decode()
        base_name=next(n for n in self.build.namelist() if n.startswith('static/css/index.') and '.compat-' in n)
        base=self.build.read(base_name).decode()
        # The six new declarations must precede the unsupported max() values.
        self.assertEqual(len(re.findall(r'padding-(?:top|right|bottom|left):[\d.]+rem;padding-(?:top|right|bottom|left):max\(',base)),6)
        html='''<!doctype html><html class="compat-chrome76"><head><style>
        body {margin:0} .card {width:200px} .image {position:relative;width:100%;overflow:hidden}
        .art {position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%}
        #actions,#header,#title {display:flex} #actions {flex-wrap:wrap;width:100px}
        button {margin:0} #actions button {width:40px;height:20px;box-sizing:border-box}
        #header>div {width:20px;height:20px} #title {align-items:baseline}
        </style></head><body>
        <div class="card" data-shape="poster"><div class="image" data-ui="poster-card-image"><div class="art"></div></div></div>
        <div class="card" data-shape="landscape"><div class="image" data-ui="poster-card-image"><div class="art"></div></div></div>
        <div class="card" data-shape="square"><div class="image" data-ui="poster-card-image"><div class="art"></div></div></div>
        <div class="card"><div class="image" data-ui="wide-card-image"><div class="art"></div></div></div>
        <div id="actions" data-ui="item-actions"><button>A</button><button>B</button><button>C</button></div>
        <div id="header" data-ui="item-header"><div></div><div></div></div>
        <h2 data-ui="media-row-title"><a id="title" class="group/title">Popular<span>Movies</span></a></h2>
        <script>
        const check=(v,m)=>{if(!v)throw Error(m)},rect=e=>e.getBoundingClientRect();
        try {
          const images=Array.from(document.querySelectorAll('.image'));
          check(images.every(e=>rect(e).height===0),'fixture must reproduce zero-height artwork');
          const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
          const expected=[300,112.5,200,112.5];
          images.forEach((e,i)=>{
            check(Math.abs(rect(e).height-expected[i])<.1,'wrong card ratio '+i);
            check(rect(e.firstChild).height>0 && rect(e.firstChild).width>0,'image loader still has zero size');
          });
          const buttons=document.querySelectorAll('#actions button');
          check(rect(buttons[1]).left-rect(buttons[0]).right===8,'horizontal action gap missing');
          check(rect(buttons[2]).top-rect(buttons[0]).bottom===8,'wrapped action gap missing');
          const parts=document.querySelectorAll('#header>div');
          check(rect(parts[1]).left-rect(parts[0]).right===32,'desktop detail header gap missing');
          check(getComputedStyle(document.querySelector('#title span')).marginLeft==='8px','catalog title spacing missing');
          document.querySelector('.card').style.width='320px';
          check(rect(images[0]).height===480,'poster ratio did not follow width');
          document.body.textContent='ARTWORK_SPACING_PASS';
        } catch(e) {document.body.textContent='FAIL: '+e.message}
        </script></body></html>'''.replace('style.textContent=CSS;', 'style.textContent='+json.dumps(css)+';')
        self.run_browser_fixture(html, 'ARTWORK_SPACING_PASS')

    def run_browser_fixture(self, html, marker):
        chrome=Path(os.environ['CHROME_BIN']) if os.environ.get('CHROME_BIN') else next(
            (Path.home()/'Library/Caches/ms-playwright').glob(
                'chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell'),None)
        if chrome is None:
            self.skipTest('Playwright Chromium headless shell required for browser fixtures')
        with tempfile.TemporaryDirectory(prefix='aiostreams-route-test-') as temp:
            fixture=Path(temp)/'route.html'
            fixture.write_text(html)
            result=subprocess.run([str(chrome),'--headless','--disable-gpu','--no-first-run',
                '--no-default-browser-check','--password-store=basic','--use-mock-keychain',
                '--disable-extensions','--timeout=5000',
                '--disable-background-networking','--user-data-dir='+str(Path(temp)/'profile'),
                '--dump-dom',fixture.as_uri()],capture_output=True,text=True,timeout=30,check=True)
            self.assertIn('<body>'+marker+'</body>',result.stdout)

if __name__=='__main__':unittest.main()
