// Iconos que el configurador puede elegir para los beneficios del login.
// Las claves coinciden con ICONOS_BENEFICIO del backend (configuracion.utils.js).
import {
  BarChart3, CalendarDays, FileSignature, FolderKanban, MessageSquare, ShieldCheck, Sparkles, Users,
} from 'lucide-react';

export const ICONOS_BENEFICIO = {
  proyectos: FolderKanban,
  agenda: CalendarDays,
  seguridad: ShieldCheck,
  equipo: Users,
  contratos: FileSignature,
  graficas: BarChart3,
  mensajes: MessageSquare,
  estrella: Sparkles,
};
