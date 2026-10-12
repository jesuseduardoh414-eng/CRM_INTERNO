import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;
const tieneKeyValida = typeof supabaseKey === 'string'
  && (supabaseKey.startsWith('eyJ') || supabaseKey.startsWith('sb_'));

let supabaseInstance = null;

if (supabaseUrl && tieneKeyValida) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseKey);
  } catch (error) {
    console.error('[Supabase] Error al inicializar Realtime.', error);
  }
} else if (supabaseUrl || supabaseKey) {
  console.warn('[Supabase] Realtime no se inicializo. Revisa VITE_SUPABASE_URL y VITE_SUPABASE_KEY.');
}

export const supabase = supabaseInstance;

if (!supabase) {
  console.info('[Supabase] Realtime desactivado en este entorno.');
}
