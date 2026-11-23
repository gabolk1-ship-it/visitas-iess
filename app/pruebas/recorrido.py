# Recorrido completo en un teléfono simulado: farmacia prepara, médico visita, supervisión revisa.
import json, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8787'
CAP = '/tmp/capturas/'
GEO = {'latitude': -0.11052, 'longitude': -78.49833, 'accuracy': 8}

def activar(p, codigo, pin):
    p.goto(BASE)
    p.get_by_label('Código de activación').fill(codigo)
    p.get_by_label('Cree un PIN de 6 números').fill(pin)
    p.get_by_label('Repita el PIN').fill(pin)
    p.get_by_label('Leí y acepto').check()
    p.get_by_role('button', name='Activar').click()

def foto(p):
    p.get_by_role('button', name='Tomar foto').click()
    p.get_by_role('button', name='Usar foto').click()

def firmar(p):
    c = p.locator('.firma canvas'); b = c.bounding_box()
    p.mouse.move(b['x'] + 30, b['y'] + 100); p.mouse.down()
    for i in range(12): p.mouse.move(b['x'] + 30 + i * 20, b['y'] + 60 + (i % 3) * 30)
    p.mouse.up()

def estado():
    return json.loads(urllib.request.urlopen(BASE + '/_estado').read())

with sync_playwright() as pw:
    nav = pw.chromium.launch(executable_path='/usr/bin/google-chrome', headless=True,
        args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    tel = dict(pw.devices['Pixel 7']); tel.update(geolocation=GEO, permissions=['camera', 'geolocation'], locale='es-EC', timezone_id='America/Guayaquil')

    # ---- Farmacia ----
    f = nav.new_context(**tel).new_page()
    f.on('dialog', lambda d: d.accept())
    activar(f, 'FARMA001', '111111')
    f.get_by_role('heading', name='Farmacia').wait_for()
    f.get_by_label('Médico').select_option('M1')
    f.get_by_text('Paciente Ficticio Uno').click()
    f.screenshot(path=CAP + '01-farmacia-bolsa.png')
    f.get_by_role('button', name='Fotografiar caja').click()
    f.wait_for_selector('video'); time.sleep(1.5)
    f.screenshot(path=CAP + '02-camara-en-vivo.png')
    foto(f)
    f.get_by_label('Lote').wait_for(timeout=90000)
    f.get_by_label('Lote').fill('AB1234'); f.get_by_label('Vencimiento').fill('2027-08-31')
    f.get_by_role('button', name='Foto de la bolsa y guardar').click()
    f.wait_for_selector('video'); time.sleep(1); foto(f)
    f.get_by_text('preparada').wait_for(timeout=30000)
    time.sleep(3)
    print('Farmacia: bolsas en servidor =', len(estado()['bolsas']))

    # ---- Médico ----
    m = nav.new_context(**tel).new_page()
    m.on('dialog', lambda d: d.accept())
    activar(m, 'MEDICO01', '222222')
    m.get_by_role('button', name='Retirar maletín').wait_for(timeout=30000)
    m.screenshot(path=CAP + '03-agenda.png')
    m.get_by_role('button', name='Retirar maletín').click()
    firmar(m); m.screenshot(path=CAP + '04-retiro.png')
    m.get_by_role('button', name='Firmar retiro').click()
    # Espera a que la app quede guardada en el teléfono y corta la conexión para toda la visita.
    m.wait_for_function("navigator.serviceWorker.controller !== null", timeout=60000)
    m.wait_for_function("caches.keys().then(async ks => { for (const k of ks) { const c = await caches.open(k); if ((await c.keys()).some(r => r.url.includes('eng.traineddata'))) return true; } return false; })", timeout=120000)
    time.sleep(3)
    m.context.set_offline(True)
    m.get_by_text('Paciente Ficticio Uno').click()
    m.get_by_role('button', name='Iniciar visita').click()
    m.get_by_role('button', name='Tomar ubicación').click()
    m.get_by_text('Foto del médico').wait_for(timeout=30000); time.sleep(1.2); foto(m)
    m.get_by_text('Foto del lugar').wait_for(); time.sleep(1.2)
    m.get_by_role('button', name='Tomar foto').click(); time.sleep(0.5)
    m.screenshot(path=CAP + '05-foto-con-sello.png')
    m.get_by_role('button', name='Usar foto').click()
    m.get_by_role('heading', name='¿Quién recibe?').wait_for()
    m.screenshot(path=CAP + '06-receptor.png')
    m.get_by_role('button', name='El paciente').click()
    m.get_by_role('button', name='Fotografiar caja').click(); time.sleep(1.2); foto(m)
    m.get_by_label('Lote').wait_for(timeout=90000)
    m.get_by_label('Lote').fill('AB1234'); m.get_by_label('Vencimiento').fill('2027-08-31')
    m.screenshot(path=CAP + '07-entrega-lote.png')
    m.get_by_role('button', name='Registrar entrega').click()
    m.get_by_role('button', name='Continuar a la firma').click()
    firmar(m); m.get_by_role('button', name='Guardar firma').click()
    time.sleep(1.2); foto(m)
    m.get_by_role('button', name='Tomar ubicación').click()
    m.get_by_text('Foto de cierre').wait_for(timeout=30000); time.sleep(1.2); foto(m)
    m.get_by_role('heading', name='Visita registrada').wait_for(timeout=30000)
    time.sleep(2)
    m.screenshot(path=CAP + '08-visita-registrada.png')
    print('Sin conexión: barra =', m.locator('.barra-sync').inner_text(), '| visitas en servidor =', len(estado()['visitas']))
    m.context.set_offline(False)
    m.wait_for_function("document.querySelector('.barra-sync')?.innerText.includes('Todo enviado')", timeout=60000)
    print('Con conexión de nuevo: barra =', m.locator('.barra-sync').inner_text())
    e = estado()
    print('Médico: visitas =', [(v['estado'], v['puntaje'], v['banderas'], v['distancia_inicio_m']) for v in e['visitas']])
    print('Entregas =', [(x['lote_leido'], x['lote_ok'], x['cantidad']) for x in e['entregas']], 'actas =', len(e['actas']), 'fotos en R2 =', e['fotos'])
    print('Alertas =', [(a['tipo'], a['severidad']) for a in e['alertas']])

    # ---- Supervisión (computadora) ----
    s = nav.new_context(viewport={'width': 1280, 'height': 900}, locale='es-EC', timezone_id='America/Guayaquil').new_page()
    activar(s, 'SUPERV01', '333333')
    s.get_by_label('Frase secreta de supervisión').fill('frase de supervisión de prueba')
    s.get_by_role('button', name='Ver visitas').click()
    s.locator('table.tabla tbody tr').first.wait_for(timeout=30000)
    s.screenshot(path=CAP + '09-visor-lista.png')
    s.locator('table.tabla tbody tr').first.click()
    s.locator('.foto img').first.wait_for(timeout=30000); time.sleep(3)
    print('Visor: fotos descifradas =', s.locator('.foto img').count(), 'de', s.locator('.foto').count())
    s.screenshot(path=CAP + '10-visor-detalle.png', full_page=True)
    nav.close()
