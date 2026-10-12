import { useState } from 'react';
import {
  Save,
  Clock,
  CalendarDays,
  UserRound,
  Building2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { agendaService } from '../services/api';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useAuth } from '../context/AuthContext';
import { useTextoAgenda } from '../hooks/useTextoAgenda';
import { aMinutosHora } from '../utils/horas';
import { horarioDelDia, limpiarHorariosPorDia } from '../utils/horarioSemana';
import Modal from './Modal';
import EditorHorarioSemana from './EditorHorarioSemana';
import PestanaMisDias from './agenda/modales/PestanaMisDias';
import PestanaCalendarioEmpresa from './agenda/modales/PestanaCalendarioEmpresa';

const CONFIG_DEFAULT = {
  diasLaborales: [1, 2, 3, 4, 5],
  horaEntrada: '09:00',
  horaSalida: '18:00',
  horaComidaInicio: '14:00',
  horaComidaFin: '15:00',
};

// Se trabaja en camelCase (lo que usa EditorHorarioSemana); acepta tambien la
// forma vieja en snake_case.
const normalizarConfig = (config) => ({
  diasLaborales: config?.diasLaborales || config?.dias_laborales || CONFIG_DEFAULT.diasLaborales,
  horaEntrada: config?.horaEntrada || config?.hora_entrada || CONFIG_DEFAULT.horaEntrada,
  horaSalida: config?.horaSalida || config?.hora_salida || CONFIG_DEFAULT.horaSalida,
  horaComidaInicio: config?.horaComidaInicio || config?.hora_comida_inicio || CONFIG_DEFAULT.horaComidaInicio,
  horaComidaFin: config?.horaComidaFin || config?.hora_comida_fin || CONFIG_DEFAULT.horaComidaFin,
  horariosPorDia: config?.horariosPorDia || config?.horarios_por_dia || {},
});

// Minutos de trabajo de un dia, descontando la comida (null si no es valido)
const minutosTrabajo = ({ entrada, salida, comidaInicio, comidaFin }) => {
  const [e, s, ci, cf] = [entrada, salida, comidaInicio, comidaFin].map(aMinutosHora);
  if (e === null || s === null || s <= e) return null;
  return s - e - (ci !== null && cf !== null && cf > ci ? cf - ci : 0);
};

// "8 h" / "7 h 30 min" para el resumen del horario
const textoDuracion = (minutos) => {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

const GOOGLE_VACIO = { configured: false, connected: false, estado: 'no_configurado', caducada: false, email: null, clientId: null, scope: '' };

// Pestañas. Las claves viejas ('HORARIO', 'DIAS') siguen sirviendo en `tabInicial`.
const PESTANAS = [
  { id: 'HORARIO', icono: Clock, textoKey: 'mod_tabHorario' },
  { id: 'DIAS', icono: UserRound, textoKey: 'mod_tabMisDias' },
  { id: 'EMPRESA', icono: Building2, textoKey: 'mod_tabEmpresa' },
  { id: 'GOOGLE', icono: RefreshCw, textoKey: 'mod_tabGoogle' },
];

/**
 * Ajustes de la agenda: mi horario, mis dias (ausencias), el calendario de la
 * empresa y Google Calendar.
 *
 * El estado de Google y sus acciones vienen de la pagina de agenda, que es
 * quien carga el script de Google Identity una sola vez. Aqui no se vuelve a
 * pedir nada de eso.
 */
const ModalConfiguracionAgenda = ({
  onClose,
  showToast,
  // Configuracion laboral con la que abrir. Se lee UNA vez: antes un efecto la
  // volvia a cargar en cada render del padre y se perdian los cambios sin
  // guardar (p. ej. al aparecer un aviso).
  configInicial = null,
  googleCalendar = GOOGLE_VACIO,
  googleLoading = false,
  onConnectGoogle,
  onDisconnectGoogle,
  // Falso si la instalacion apago el modulo de Google Calendar: no se muestra.
  googleActivo = true,
  // Avisos al padre para que refresque sin tener que volver a pedirlo todo
  onConfigGuardada,
  onDiasEspecialesCambiados,
  // Opcional: cambios en el calendario de la empresa. Sin el, se usa el aviso
  // de dias especiales, que ya hace que la pagina recargue.
  onDiasEmpresaCambiados,
  // Opcional: pestaña con la que abrir ('HORARIO' | 'DIAS' | 'EMPRESA' | 'GOOGLE')
  tabInicial = 'HORARIO',
}) => {
  const { t } = usePreferences();
  const tx = useTextoAgenda();
  const { moduloActivo } = useConfiguracion();
  const conGoogle = googleActivo && moduloActivo('googleCalendar');
  // El calendario de la empresa solo lo ven y administran los administradores.
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'ADMIN';
  const pestanas = PESTANAS.filter((p) => (p.id !== 'GOOGLE' || conGoogle) && (p.id !== 'EMPRESA' || esAdmin));
  const [tab, setTab] = useState(() => (pestanas.some((p) => p.id === tabInicial) ? tabInicial : 'HORARIO'));
  const [cargando, setCargando] = useState(false);
  const [config, setConfig] = useState(() => normalizarConfig(configInicial));

  const handleSaveConfig = async () => {
    setCargando(true);
    try {
      // Solo viajan los dias con horario distinto al general
      const res = await agendaService.updateConfigLaboral({
        dias_laborales: config.diasLaborales,
        hora_entrada: config.horaEntrada,
        hora_salida: config.horaSalida,
        hora_comida_inicio: config.horaComidaInicio,
        hora_comida_fin: config.horaComidaFin,
        horarios_por_dia: limpiarHorariosPorDia(config),
      });
      showToast(t('agendaSettingsSaved'));
      onConfigGuardada?.(res?.config || config);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCargando(false);
    }
  };

  // Resumen: horas de trabajo (descontando la comida) del dia, o de la semana
  // si algun dia tiene horario propio
  const laborales = config.diasLaborales || [];
  const minutosPorDia = laborales.map((dia) => minutosTrabajo(horarioDelDia(config, dia)));
  const jornadaValida = minutosPorDia.every((m) => m !== null && m > 0);
  const conPropios = Object.keys(limpiarHorariosPorDia(config)).length > 0;
  const nDias = laborales.length;
  const resumenHorario = !jornadaValida
    ? tx('mod_jornadaInvalida')
    : conPropios
      ? tx('mod_resumenSemana', { horas: textoDuracion(minutosPorDia.reduce((a, b) => a + b, 0)), dias: nDias })
      : tx('mod_resumenJornada', { horas: textoDuracion(minutosPorDia[0] || 0), dias: nDias });

  const googleBloqueado = googleLoading || !googleCalendar.configured;
  const avisarDias = onDiasEspecialesCambiados;
  const avisarEmpresa = onDiasEmpresaCambiados || onDiasEspecialesCambiados;

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="640px"
      // `dvh`: en el móvil la barra del navegador no tapa el pie
      height="min(720px, 90dvh)"
      bodyClassName="agm-cuerpo"
      title={t('agendaSettingsTitle')}
      subtitle={tx('mod_ajustesSub')}
      subHeader={(
        <div role="tablist" aria-label={t('agendaSettingsTitle')} className="dash-pestanas agm-pestanas px-5 pb-2.5">
          {pestanas.map((p) => {
            const Icono = p.icono;
            return (
              <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)}>
                <Icono size={15} aria-hidden="true" /> {tx(p.textoKey)}
              </button>
            );
          })}
        </div>
      )}
      // Solo "Mi horario" tiene algo que guardar al final; las demas guardan
      // cada dia al momento.
      footer={tab === 'HORARIO' ? (
        <div className="flex items-center justify-between gap-3">
          <span className="agm-ayuda truncate">
            {resumenHorario}
          </span>
          <button type="button" onClick={handleSaveConfig} disabled={cargando} className="btn-primary h-9 shrink-0 !py-0 text-[13.5px]">
            <Save size={15} /> {cargando ? t('saving') : t('agendaSaveSettings')}
          </button>
        </div>
      ) : null}
    >
      {tab === 'HORARIO' && (
        <div className="agm-seccion !gap-5" role="tabpanel">
          <EditorHorarioSemana idBase="cfg-horario" valor={config} onCambio={setConfig} />
          <p className="agm-nota agm-nota-info"><CalendarDays size={14} /> {tx('mod_horarioUso')}</p>
        </div>
      )}

      {tab === 'DIAS' && (
        <div role="tabpanel"><PestanaMisDias showToast={showToast} onCambio={avisarDias} /></div>
      )}

      {tab === 'EMPRESA' && esAdmin && (
        <div role="tabpanel"><PestanaCalendarioEmpresa showToast={showToast} onCambio={avisarEmpresa} /></div>
      )}

      {tab === 'GOOGLE' && conGoogle && (
        <div className="agm-seccion !gap-4" role="tabpanel">
          <div className="agm-caja agm-seccion">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="agm-etiqueta">Google Calendar</span>
                <p className="mt-1 text-[15px] font-semibold text-[var(--color-text)]">
                  {googleCalendar.connected ? t('agendaGoogleAccountConnected') : t('agendaGoogleSyncOff')}
                </p>
              </div>
              <span className={googleCalendar.connected ? 'badge-success' : googleCalendar.caducada ? 'badge-warning' : 'badge-neutral'}>
                {googleCalendar.connected ? t('agendaGoogleActive') : t('agendaGoogleInactive')}
              </span>
            </div>
            <p className="text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
              {googleCalendar.connected
                ? t('agendaGoogleSyncDesc', { email: googleCalendar.email || t('agendaGoogleMainCalendar') })
                : t('agendaGoogleConnectDesc')}
            </p>
            {/* Tokens borrados por el servidor (invalid_grant) pero correo
                guardado: la conexion existio y caduco. */}
            {googleCalendar.caducada && (
              <p role="status" className="agm-nota agm-nota-aviso"><AlertTriangle size={14} /> {t('agendaGoogleExpired')}</p>
            )}
            {!googleCalendar.configured && (
              <p className="agm-nota agm-nota-aviso"><AlertTriangle size={14} /> {tx('mod_googleSinCredenciales')}</p>
            )}
            {googleCalendar.connected && (
              <p className="agm-nota agm-nota-exito"><CheckCircle2 size={14} /> {tx('mod_googleQueSincroniza')}</p>
            )}
            <div className="flex justify-end">
              {!googleCalendar.connected ? (
                <button
                  type="button"
                  className="btn-primary h-9 !py-0 text-[13.5px]"
                  onClick={() => onConnectGoogle?.()}
                  disabled={googleBloqueado}
                >
                  {googleLoading ? t('projectsConnecting') : googleCalendar.caducada ? t('agendaGoogleReconnect') : t('agendaGoogleConnectTitle')}
                </button>
              ) : (
                <button
                  type="button"
                  className="agm-boton agm-boton-peligro"
                  onClick={() => onDisconnectGoogle?.()}
                  disabled={googleLoading}
                >
                  {googleLoading ? t('projectsDisconnecting') : t('agendaGoogleDisconnect')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default ModalConfiguracionAgenda;
