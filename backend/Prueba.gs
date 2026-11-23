/**
 * Datos ficticios para probar la app. Se ejecuta una sola vez desde el editor (función cargarDatosDePrueba).
 * Crea usuarios con códigos de activación, pacientes inventados en Cotocollao, agenda de 7 días y órdenes.
 * No usar con datos reales.
 */
function cargarDatosDePrueba() {
  configurarHojas();
  const hoy = new Date();
  const fecha = function (dias) { return fechaLocal_(new Date(hoy.getTime() + dias * 86400000)); };
  const codigo = function () {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 8; i++) c += a[Math.floor(Math.random() * a.length)];
    return c;
  };
  const usuarios = [
    { id: 'M1', nombre: 'Dra. Prueba Uno', correo: '', rol: 'medico', codigo_activacion: codigo(), activo: 'SI' },
    { id: 'M2', nombre: 'Dr. Prueba Dos', correo: '', rol: 'medico', codigo_activacion: codigo(), activo: 'SI' },
    { id: 'F1', nombre: 'Farmacia Prueba', correo: '', rol: 'farmacia', codigo_activacion: codigo(), activo: 'SI' },
    { id: 'S1', nombre: 'Supervisión Prueba', correo: '', rol: 'supervisor', codigo_activacion: codigo(), activo: 'SI' },
    { id: 'A1', nombre: 'Administración Prueba', correo: '', rol: 'admin', codigo_activacion: codigo(), activo: 'SI' }
  ];
  agregar_('Usuarios', usuarios);
  agregar_('Pacientes', [
    { id: 'P1', codigo_afiliado: '1700000011', nombre: 'Paciente Ficticio Uno', sector: 'Cotocollao', direccion: 'Calle Ficticia N50-10', lat: '', lon: '', radio_m: '', qr_codigo: '', telefono_contacto: '' },
    { id: 'P2', codigo_afiliado: '1700000022', nombre: 'Paciente Ficticio Dos', sector: 'La Ofelia', direccion: 'Pasaje Inventado 3', lat: '', lon: '', radio_m: '', qr_codigo: '', telefono_contacto: '' },
    { id: 'P3', codigo_afiliado: '1700000033', nombre: 'Paciente Ficticio Tres', sector: 'Comité del Pueblo', direccion: 'Av. Supuesta 123', lat: '', lon: '', radio_m: '', qr_codigo: '', telefono_contacto: '' }
  ]);
  agregar_('Cuidadores', [
    { id: 'C1', paciente_id: 'P1', nombre: 'Cuidadora Ficticia', cedula: '1700000099', parentesco: 'hija', autorizado_controlados: 'SI' }
  ]);
  const agenda = [];
  for (let d = 0; d < 7; d++) {
    agenda.push({ id: 'AG-' + fecha(d) + '-1', fecha: fecha(d), medico_id: 'M1', paciente_id: 'P1', ventana: 'mañana', estado: 'pendiente' });
    agenda.push({ id: 'AG-' + fecha(d) + '-2', fecha: fecha(d), medico_id: 'M1', paciente_id: 'P2', ventana: 'mañana', estado: 'pendiente' });
    agenda.push({ id: 'AG-' + fecha(d) + '-3', fecha: fecha(d), medico_id: 'M2', paciente_id: 'P3', ventana: 'tarde', estado: 'pendiente' });
  }
  agregar_('Agenda', agenda);
  agregar_('Ordenes', [
    { orden_id: 'T100|MED01', codigo_afiliado: '1700000011', medicamento_codigo: 'MED01', medicamento: 'Losartán 50 mg (ficticio)', cantidad: '30', desde: fecha(-1), hasta: fecha(30), controlado: 'NO', receta_especial: '', importado: hoy.toISOString() },
    { orden_id: 'T100|MED02', codigo_afiliado: '1700000011', medicamento_codigo: 'MED02', medicamento: 'Clonazepam 2 mg (ficticio)', cantidad: '10', desde: fecha(-1), hasta: fecha(30), controlado: 'SI', receta_especial: 'RE-PRUEBA-1', importado: hoy.toISOString() },
    { orden_id: 'T200|MED03', codigo_afiliado: '1700000022', medicamento_codigo: 'MED03', medicamento: 'Metformina 850 mg (ficticio)', cantidad: '60', desde: fecha(-1), hasta: fecha(30), controlado: 'NO', receta_especial: '', importado: hoy.toISOString() },
    { orden_id: 'T300|MED01', codigo_afiliado: '1700000033', medicamento_codigo: 'MED01', medicamento: 'Losartán 50 mg (ficticio)', cantidad: '30', desde: fecha(-1), hasta: fecha(30), controlado: 'NO', receta_especial: '', importado: hoy.toISOString() }
  ]);
  const lista = tabla_('Usuarios').map(function (u) { return u.id + ' · ' + u.nombre + ' (' + u.rol + '): ' + u.codigo_activacion; }).join('\n');
  console.log('Códigos de activación de prueba:\n' + lista);
  return lista;
}
