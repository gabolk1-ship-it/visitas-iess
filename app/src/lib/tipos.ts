export type Rol = 'medico' | 'farmacia' | 'supervisor' | 'admin';

export interface Usuario { id: string; nombre: string; rol: Rol }

export interface LlavePublica { kty: string; n: string; e: string; alg?: string }

export interface ConfigApp {
  version: string;
  usuario: Usuario;
  geocercaM: number;
  precisionMaxM: number;
  visitaMinMin: number;
  llavePublica: LlavePublica | null;
}

export interface Paciente {
  id: string; codigo_afiliado: string; nombre: string; sector: string; direccion: string;
  lat: number | null; lon: number | null; radio_m: number | null; qr_codigo: string | null; telefono_contacto: string;
}

export interface Cuidador { id: string; paciente_id: string; nombre: string; cedula: string; parentesco: string; autorizado_controlados: boolean }

export interface ItemBolsa {
  id: string; orden_id: string; medicamento_codigo: string; medicamento: string;
  lote: string; vencimiento: string; cantidad: number; controlado: boolean;
}

export interface Bolsa { id: string; fecha: string; medico_id: string; paciente_id: string; estado: string; items: ItemBolsa[] }

export interface ItemAgenda { id: string; paciente_id: string; ventana: string; estado: string }

export interface AgendaDia { fecha: string; agenda: ItemAgenda[]; pacientes: Paciente[]; cuidadores: Cuidador[]; bolsas: Bolsa[] }

export interface Orden { orden_id: string; medicamento_codigo: string; medicamento: string; cantidad: number; controlado: boolean; receta_especial: string }

/** Foto cifrada: la llave AES va envuelta con la llave pública de supervisión. */
export interface FotoCifrada { key: string; llave: string; hash: string }

export interface Lectura { lat: number; lon: number; precision: number; t: number }

export interface Ubicacion { lat: number; lon: number; precision: number; lecturas: Lectura[] }

export type TablaSync = 'eventos' | 'entregas' | 'actas' | 'movimientos' | 'bolsas' | 'preparaciones';
