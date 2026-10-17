"""Sign-in in a real browser, with a simulated passkey device (Chromium's virtual
authenticator). Needs the passwords and passkeys modules installed, and the page
opened on a name, not an IP address (passkeys refuse bare IPs):

    python3 test/browser/signin.py http://localhost:7780/
"""
from playwright.sync_api import sync_playwright
import sys, random
url = sys.argv[1].rstrip('/') + '/'
N = random.randrange(10000)
V="document.querySelector('.seal .statement')?.textContent.includes('verified in this browser')"
def send(pg):
    pg.click('[data-send=own]'); pg.wait_for_function("document.querySelector('#send-result').textContent.includes('settled') || document.querySelector('#send-result').className==='bad'", timeout=60000)
    t=pg.inner_text('#send-result'); pg.click('#send button[value=close]'); return t
def authenticator(pg):
    c=pg.context.new_cdp_session(pg); c.send('WebAuthn.enable')
    c.send('WebAuthn.addVirtualAuthenticator', {'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})
with sync_playwright() as p:
    b=p.chromium.launch(); errs=[]
    # 1. join with a password
    pg=b.new_context().new_page(); pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('dialog', lambda d: (d.accept(d.default_value or 'Laptop')))
    pg.goto(url); pg.wait_for_function(V); pg.wait_for_selector('#join-id')
    pg.fill('#join-id',f'pat{N}'); pg.fill('#join-pw','a long enough passphrase 1'); pg.fill('#join-pw2','a long enough passphrase 1')
    pg.click('text=Join with this password'); pg.wait_for_selector('#send[open]', timeout=30000); print('password join:', send(pg))
    pg.reload(); pg.wait_for_function(V); pg.wait_for_selector('#si-id')
    pg.fill('#si-id',f'pat{N}'); pg.fill('#si-pw','wrong password here 1'); pg.click('#view button:has-text("Sign in")'); pg.wait_for_function("document.querySelector('#si-result').textContent.includes('not right')"); print('wrong password refused')
    pg.fill('#si-pw','a long enough passphrase 1'); pg.click('#view button:has-text("Sign in")'); pg.wait_for_selector('text=signed in with your password')
    print('password sign-in ok')
    # add a passkey to the password member
    authenticator(pg)
    pg.click('text=Ways to sign in'); pg.click('text=Add a passkey on this device'); pg.wait_for_selector('#send[open]', timeout=30000); print('add passkey:', send(pg))
    pg.reload(); pg.wait_for_function(V); pg.wait_for_selector('#si-id')
    pg.click('text=Sign in with a passkey'); pg.wait_for_selector('text=signed in with a passkey', timeout=30000); print('passkey sign-in (pat) ok')
    pg.goto(url+'#/votes'); pg.wait_for_selector('text=Lay a proposal'); pg.click('text=Lay a proposal'); pg.fill('#lay-title','Signed with Face ID')
    pg.click('text=Sign this proposal'); pg.wait_for_selector('#send[open]', timeout=30000); print('act by passkey:', send(pg))
    pg.goto(url+'#/'); pg.reload(); pg.wait_for_function(V); pg.click('text=Ways to sign in'); print('ways:', pg.inner_text('#view details[open] ul').replace('\n',' | '))
    # 2. join with a passkey only
    pg2=b.new_context().new_page(); pg2.on('pageerror', lambda e: errs.append(str(e))); authenticator(pg2)
    pg2.goto(url); pg2.wait_for_function(V); pg2.wait_for_selector('#join-id'); pg2.fill('#join-id',f'fay{N}')
    pg2.click('text=Join with a passkey'); pg2.wait_for_selector('#send[open]', timeout=30000); print('passkey join:', send(pg2))
    pg2.reload(); pg2.wait_for_function(V); pg2.wait_for_selector('text=signed in with a passkey'); print('fay remembered on this device')
    print('errors', errs); b.close()
