import { useState, useEffect } from 'react';
import {
  Save,
  AlertTriangle,
  Trash2,
  Globe,
  MapPin,
  Video,
  Link2,
  ChevronRight,
  Repeat,
  Bell,
  CheckCircle2,
  CalendarDays,
  FolderKanban,
  ExternalLink,
  Check,
  X,
} from 'lucide-react';
import { agendaService, adjuntosService, usuariosService } from '../services/api';
import Modal from './Modal';
import Tooltip from './Tooltip';
import { useAuth } from '../context/AuthContext';
import { puede } from '../utils/permisos';
import { useToast } from '../context/ToastContext';
import { usePreferences } from '../context/PreferencesContext';
import { useConfiguracion } from '../context/ConfiguracionContext';
import { useTextoAgenda } from '../hooks/useTextoAgenda';
import { claveDiaLocal, fechaDesdeClave } from '../utils/fechasLocales';
import TaskAttachments from './TaskAttachments';
import SelectorRangoFechas from './SelectorRangoFechas';
import SelectorMultiple from './SelectorMultiple';
import { Switch } from './ui/switch';
import { SelectorRangoHoras } from './SelectorHora';
import { formatoHora } from '../utils/horas';
import SugerirHorario from './agenda/modales/SugerirHorario';
import EnlaceReunion from './agenda/modales/EnlaceReunion';
import ParticipantesEvento from './agenda/modales/ParticipantesEvento';
import SelectorClienteEvento from './portal/SelectorClienteEvento';
import { AVISOS_EVENTO, CATEGORIAS_EVENTO, esUrlHttp } from './agenda/modales/catalogos';
import { enfocarAlCargar } from '../utils/dispositivo';

// Color por categoria. El servidor vuelve a calcularlo al guardar; aqui solo
// sirve para que el formulario lleve un valor coherente.
const COLOR_CATEGORIA = {
  tarea: '#16a34a',
  reunion: '#7c3aed',
  evento: '#2563eb',
};

const getColorCategoria = (tipo) => COLOR_CATEGORIA[tipo] || COLOR_CATEGORIA.evento;

const dosDigitos = (n) => String(n).padStart(2, '0');

const horaLocal = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  return `${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`;
};

/** 'YYYY-MM-DD' + 'HH:mm' -> Date local (sin zona, el navegador lo toma como local). */
const fechaHoraLocal = (clave, hora) => new Date(`${clave}T${hora || '00:00'}`);

const FORM_VACIO = {
  titulo: '',
  descripcion: '',
  tipo: 'evento',
  modalidad: 'presencial',
  ubicacion: '',
  url_reunion: '',
  instrucciones_acceso: '',
  fecha_inicio: '',
  hora_inicio: '09:00',
  fecha_fin: '',
  hora_fin: '10:00',
  todo_el_dia: false,
  color: getColorCategoria('evento'),
  alerta_minutos: 15,
  es_compartido: false,
  es_global: false,
  proyecto_id: '',
  empresa_id: '',
  invitados_ids: [],
  // Repeticion semanal (solo al crear): dias 0 = domingo ... 6 = sabado,
  // igual que el patron del servidor.
  repetir: false,
  repetir_dias: [],
  repetir_hasta: '',
};

const buildInitialForm = ({ evento, prefill }) => {
  if (evento) {
    const start = new Date(evento.fechaInicio);
    const end = evento.fechaFin ? new Date(evento.fechaFin) : null;

    return {
      ...FORM_VACIO,
      titulo: evento.titulo,
      descripcion: evento.descripcion || '',
      tipo: evento.tipo,
      modalidad: evento.modalidad || 'presencial',
      ubicacion: evento.ubicacion || '',
      url_reunion: evento.urlReunion || '',
      instrucciones_acceso: evento.instruccionesAcceso || '',
      fecha_inicio: claveDiaLocal(start),
      hora_inicio: horaLocal(start),
      fecha_fin: end ? claveDiaLocal(end) : claveDiaLocal(start),
      hora_fin: end ? horaLocal(end) : horaLocal(new Date(start.getTime() + 3600000)),
      todo_el_dia: !!evento.todoElDia,
      color: getColorCategoria(evento.tipo),
      // 0 significa "sin alerta" en el backend: `||` lo convertia en 15.
      alerta_minutos: evento.alertaMinutos ?? 15,
      es_compartido: evento.esCompartido || false,
      es_global: evento.esGlobal || false,
      proyecto_id: evento.proyectoId || '',
      empresa_id: evento.empresaId || '',
      invitados_ids: evento.invitados?.map((i) => i.usuarioId) || [],
    };
  }

  if (prefill) {
    const start = prefill.fechaInicio ? new Date(prefill.fechaInicio) : new Date();
    const clave = claveDiaLocal(start);

    // Desde una celda del mes no hay hora: se propone la jornada tipica.
    // Desde una franja de Semana/Dia, la hora pulsada y una hora de duracion;
    // si eso cruza la medianoche, el fin se queda en 23:59.
    let horaInicio = FORM_VACIO.hora_inicio;
    let horaFin = FORM_VACIO.hora_fin;
    if (!prefill.sinHora) {
      const inicio = new Date(start);
      inicio.setSeconds(0, 0);
      const fin = new Date(inicio.getTime() + 3600000);
      horaInicio = horaLocal(inicio);
      horaFin = claveDiaLocal(fin) === clave ? horaLocal(fin) : '23:59';
    }

    return {
      ...FORM_VACIO,
      // La pagina puede abrir la ventana ya como reunion (p. ej. "Programar reunion")
      tipo: prefill.tipo && CATEGORIAS_EVENTO.some((c) => c.id === prefill.tipo) ? prefill.tipo : FORM_VACIO.tipo,
      todo_el_dia: prefill.tipo === 'dia_completo',
      fecha_inicio: clave,
      hora_inicio: horaInicio,
      fecha_fin: clave,
      hora_fin: horaFin,
    };
  }

  return { ...FORM_VACIO };
};

/**
 * Pasos del alta de evento. El usuario eligio este agrupamiento: primero lo que
 * define el evento, luego donde ocurre y al final quien participa.
 */
const PASOS_EVENTO = [
  { id: 1, labelKey: 'eventStepBasics' },
  { id: 2, labelKey: 'eventStepWhere' },
  { id: 3, labelKey: 'eventStepWho' },
];

// Patron guardado de una serie -> objeto (puede llegar como texto JSON)
const leerPatron = (evento) => {
  const crudo = evento?.patronRecurrencia;
  if (!crudo) return null;
  try {
    return typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
  } catch {
    return null;
  }
};

/** Etiqueta de campo con "· opcional" al lado, como en el resto del CRM. */
const Etiqueta = ({ htmlFor, id, texto, opcional = false, icono = null }) => {
  const { t } = usePreferences();
  const Tag = htmlFor ? 'label' : 'span';
  return (
    <Tag htmlFor={htmlFor} id={id} className="form-label flex items-center gap-1.5">
      {icono}
      {texto}
      {opcional && <span className="text-[12px] font-normal text-[var(--color-text-muted)]">· {t('fieldOptional')}</span>}
    </Tag>
  );
};

const ModalEvento = ({
  evento,
  prefill,
  onClose,
  onSave,
  onDelete,
  // Opcional: tras responder a una invitacion. Sin el, se usa `onSave` (que
  // cierra y recarga la agenda).
  onRespondido,
}) => {
  const { t, locale } = usePreferences();
  const tx = useTextoAgenda();
  // Con el modulo de adjuntos apagado no se muestran los documentos del evento
  // (el permiso de subir adjuntos no aplica a la agenda).
  const { moduloActivo } = useConfiguracion();
  const adjuntosActivos = moduloActivo('adjuntos');
  const [form, setForm] = useState(() => buildInitialForm({ evento, prefill }));
  const { usuario } = useAuth();
  const { showToast } = useToast();
  const [cargando, setCargando] = useState(false);
  const [respondiendo, setRespondiendo] = useState(false);
  const [usuarios, setUsuarios] = useState([]);
  // Conflictos del horario elegido y la consulta a la que corresponden
  const [disp, setDisp] = useState({ clave: '', conflictos: [] });
  const [archivos, setArchivos] = useState([]);
  const [paso, setPaso] = useState(1);
  const [errorTitulo, setErrorTitulo] = useState(false);

  const esDuenio = !evento || evento.usuarioId === usuario?.id || evento.creadoPorId === usuario?.id;
  // "Todo el equipo" pide "agenda.eventosEmpresa".
  const esAdmin = puede(usuario, 'agenda.eventosEmpresa');
  // Reunión con cliente (portal de clientes): quien ve el directorio.
  const puedeLigarCliente = puede(usuario, 'clientes.ver') && moduloActivo('clientes') && moduloActivo('portalClientes');
  const esVirtual = form.modalidad === 'virtual';
  // Un evento que se repite llega siempre como una ocurrencia. Sus fechas las
  // marca el patron de la serie, no esta ocurrencia: se muestran pero no se
  // editan desde aqui, y al guardar no se envian (si se enviaran, moverian el
  // inicio de toda la serie al dia pulsado).
  const esRecurrente = !!(evento?.esRecurrente || evento?.esOcurrencia || evento?.patronRecurrencia);
  const fechasEditables = esDuenio && !esRecurrente;
  const esDiaCompleto = form.tipo === 'dia_completo';
  const todoElDia = esDiaCompleto || form.todo_el_dia;

  useEffect(() => {
    const cargar = async () => {
      try {
        const resU = await usuariosService.listar();
        setUsuarios(resU.usuarios || []);
      } catch (err) {
        console.error(err);
      }
    };
    cargar();
  }, []);

  // Inicio y fin del evento como instantes. Se envian con zona (ISO): sin ella,
  // el servidor (UTC) tomaba las 10:00 de Mexico como las 10:00 UTC.
  const instantes = () => {
    const inicio = fechaHoraLocal(form.fecha_inicio, todoElDia ? '00:00' : (form.hora_inicio || '00:00'));
    const fin = fechaHoraLocal(form.fecha_fin || form.fecha_inicio, todoElDia ? '23:59' : (form.hora_fin || '23:59'));
    return { inicio, fin };
  };

  // Disponibilidad de los invitados en el horario elegido
  const { inicio: inicioElegido, fin: finElegido } = form.fecha_inicio ? instantes() : { inicio: null, fin: null };
  const rangoValido = inicioElegido && !Number.isNaN(inicioElegido.getTime()) && !Number.isNaN(finElegido.getTime()) && finElegido > inicioElegido;
  const consultaDisp = form.es_compartido && !form.es_global && form.invitados_ids.length > 0 && rangoValido
    ? `${form.invitados_ids.join(',')}|${inicioElegido.toISOString()}|${finElegido.toISOString()}`
    : '';

  useEffect(() => {
    if (!consultaDisp) return undefined;
    let active = true;
    const [ids, inicio, fin] = consultaDisp.split('|');
    agendaService.consultarDisponibilidad({ usuarios_ids: ids, inicio, fin, excluir_id: evento?.id, sin_proyectos: true })
      .then((res) => { if (active) setDisp({ clave: consultaDisp, conflictos: res.conflictos || [] }); })
      .catch((err) => { if (active) console.error('Error disponibilidad', err); });
    return () => { active = false; };
  }, [consultaDisp, evento?.id]);

  const dispComprobada = Boolean(consultaDisp) && disp.clave === consultaDisp;
  const disponibilidad = dispComprobada ? disp.conflictos : [];
  const idsOcupados = new Set(disponibilidad.map((d) => d.usuarioId));

  // Al editar no hay pasos: se ve todo de corrido, igual que en proyectos.
  const conPasos = !evento;
  const enPaso = (n) => !conPasos || paso === n;

  const validarPaso = (n) => {
    if (n === 1 && !form.titulo.trim()) return t('eventTitleRequired');
    return null;
  };

  const avanzar = () => {
    const error = validarPaso(paso);
    if (error) {
      setErrorTitulo(true);
      showToast(error, 'error');
      return;
    }
    setPaso((n) => Math.min(PASOS_EVENTO.length, n + 1));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!esDuenio) return;

    // Enter en un paso intermedio avanza; antes creaba el evento saltandose
    // los pasos de lugar y participantes.
    if (conPasos && paso < PASOS_EVENTO.length) {
      avanzar();
      return;
    }

    const errorTituloTexto = validarPaso(1);
    if (errorTituloTexto) {
      setErrorTitulo(true);
      if (conPasos) setPaso(1);
      showToast(errorTituloTexto, 'error');
      return;
    }

    if (!form.fecha_inicio) {
      showToast(t('eventInvalidDateTime'), 'error');
      return;
    }

    const { inicio: fInicio, fin: fFin } = instantes();

    if (Number.isNaN(fInicio.getTime()) || Number.isNaN(fFin.getTime())) {
      showToast(t('eventInvalidDateTime'), 'error');
      return;
    }

    if (fFin <= fInicio) {
      showToast(t('eventEndAfterStart'), 'error');
      return;
    }

    const urlReunion = String(form.url_reunion || '').trim();
    if (urlReunion && !esUrlHttp(urlReunion)) {
      if (conPasos) setPaso(2);
      showToast(t('agendaLinkMustBeHttp'), 'error');
      return;
    }

    if (!evento && form.repetir && form.repetir_dias.length === 0) {
      if (conPasos) setPaso(1);
      showToast(tx('mod_repetirSinDias'), 'error');
      return;
    }

    setCargando(true);
    try {
      const compartido = !!form.es_compartido;
      const payload = {
        titulo: form.titulo.trim(),
        descripcion: form.descripcion,
        tipo: form.tipo,
        modalidad: form.modalidad,
        ubicacion: form.ubicacion,
        url_reunion: urlReunion,
        instrucciones_acceso: form.instrucciones_acceso,
        fecha_inicio: fInicio.toISOString(),
        fecha_fin: fFin.toISOString(),
        todo_el_dia: todoElDia,
        color: getColorCategoria(form.tipo),
        alerta_minutos: form.alerta_minutos,
        es_compartido: compartido,
        proyecto_id: form.proyecto_id ? parseInt(form.proyecto_id, 10) : null,
        invitados_ids: compartido && !form.es_global ? form.invitados_ids : [],
      };

      // "Todo el equipo" solo lo acepta el servidor de quien tiene el permiso;
      // los demas no lo envian y el servidor conserva lo que hubiera.
      if (esAdmin) payload.es_global = compartido && !!form.es_global;
      if (puedeLigarCliente) payload.empresa_id = form.empresa_id ? parseInt(form.empresa_id, 10) : null;

      // Serie semanal nueva: el patron lleva las mismas horas del evento
      if (!evento && form.repetir) {
        payload.es_recurrente = true;
        payload.patron_recurrencia = {
          tipo: 'semanal',
          dias: form.repetir_dias,
          horaInicio: todoElDia ? '00:00' : form.hora_inicio,
          horaFin: todoElDia ? '23:59' : form.hora_fin,
        };
        if (form.repetir_hasta) payload.fecha_fin_recurrencia = fechaHoraLocal(form.repetir_hasta, '23:59').toISOString();
      }

      // Ocurrencia de una serie: las fechas no viajan (ver `esRecurrente`).
      if (esRecurrente) {
        delete payload.fecha_inicio;
        delete payload.fecha_fin;
        delete payload.todo_el_dia;
      }

      let eventoGuardado = evento;
      if (evento) {
        const res = await agendaService.editar(evento.id, payload);
        eventoGuardado = res.evento || evento;
      } else {
        const res = await agendaService.crear(payload);
        eventoGuardado = res.evento;
      }

      if (archivos.length > 0 && eventoGuardado?.id) {
        await adjuntosService.subir(eventoGuardado.id, archivos, 'agenda');
        setArchivos([]);
      }

      onSave();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setCargando(false);
    }
  };

  // Respuesta del invitado (RSVP) desde la propia ventana
  const responder = async (estado) => {
    setRespondiendo(true);
    try {
      await agendaService.responderInvitacion(evento.id, estado);
      showToast(estado === 'aceptado' ? tx('mod_rsvpRespondidoSi') : tx('mod_rsvpRespondidoNo'));
      (onRespondido || onSave)?.(estado);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setRespondiendo(false);
    }
  };

  // Uno mismo nunca aparece en la lista: ya esta dentro por ser el creador.
  const miembrosElegibles = usuarios.filter((u) => u.id !== usuario?.id);

  const togggleInvitado = (userId) => {
    setForm((prev) => {
      const ids = [...prev.invitados_ids];
      const idx = ids.indexOf(userId);
      if (idx > -1) ids.splice(idx, 1);
      else ids.push(userId);
      return { ...prev, invitados_ids: ids };
    });
  };

  const elegirCategoria = (tipo) => setForm((prev) => ({
    ...prev,
    tipo,
    color: getColorCategoria(tipo),
    // "Todo el dia" como categoria lo marca; salir de ella lo devuelve a horas
    todo_el_dia: tipo === 'dia_completo' ? true : prev.tipo === 'dia_completo' ? false : prev.todo_el_dia,
  }));

  const toggleRepetir = (valor) => setForm((prev) => {
    // Por defecto se repite el mismo dia de la semana del evento
    const diaBase = fechaDesdeClave(prev.fecha_inicio)?.getDay();
    return {
      ...prev,
      repetir: valor,
      repetir_dias: valor && prev.repetir_dias.length === 0 && diaBase !== undefined ? [diaBase] : prev.repetir_dias,
    };
  });

  const toggleDiaRepeticion = (dia) => setForm((prev) => ({
    ...prev,
    repetir_dias: prev.repetir_dias.includes(dia)
      ? prev.repetir_dias.filter((d) => d !== dia)
      : [...prev.repetir_dias, dia].sort((a, b) => a - b),
  }));

  // Iniciales de la semana en el idioma activo, en el orden del patron
  // (0 = domingo). 2024-01-07 fue domingo.
  const inicialesSemana = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 7 + i, 12);
    return { id: i, inicial: d.toLocaleDateString(locale, { weekday: 'narrow' }).toUpperCase(), nombre: d.toLocaleDateString(locale, { weekday: 'long' }) };
  });
  // En pantalla, lunes primero
  const semanaLunes = [...inicialesSemana.slice(1), inicialesSemana[0]];

  // Fechas para mostrar: se construyen desde la clave local, no desde
  // `new Date('YYYY-MM-DD')` (que es UTC y en Mexico cae en el dia anterior).
  const formatoFecha = { weekday: 'short', day: 'numeric', month: 'short' };
  const fechaInicioTexto = fechaDesdeClave(form.fecha_inicio)?.toLocaleDateString(locale, formatoFecha) || '';
  const fechaFinTexto = fechaDesdeClave(form.fecha_fin || form.fecha_inicio)?.toLocaleDateString(locale, formatoFecha) || '';
  const variosDias = form.fecha_fin && form.fecha_fin !== form.fecha_inicio;
  const rangoHorasTexto = `${formatoHora(form.hora_inicio, locale)} – ${formatoHora(form.hora_fin, locale)}`;
  const horarioTexto = `${fechaInicioTexto}${variosDias ? ` – ${fechaFinTexto}` : ''} · ${todoElDia ? tx('mod_todoElDia') : rangoHorasTexto}`;

  // "Todo el equipo" solo lo elige quien tiene el permiso. Si otro usuario abre
  // un evento que ya era global, lo ve como tal pero no puede cambiarlo.
  const puedeElegirGlobal = esAdmin;

  // RSVP: respuesta de cada invitado guardado
  const estadosRsvp = Object.fromEntries((evento?.invitados || []).map((i) => [i.usuarioId, i.estado]));
  const organizadorId = evento ? (evento.creadoPorId || evento.usuarioId) : usuario?.id;
  const organizador = usuarios.find((u) => u.id === organizadorId)
    || (evento ? evento.creador : usuario)
    || null;
  const idsParticipantes = form.invitados_ids.filter((id) => id !== organizadorId);
  const miRespuesta = !esDuenio ? estadosRsvp[usuario?.id] : null;

  const patron = leerPatron(evento);
  const categoria = CATEGORIAS_EVENTO.find((c) => c.id === form.tipo) || CATEGORIAS_EVENTO[0];
  const nombreCategoria = (c) => (c.tKey ? t(c.tKey) : tx(c.textoKey));

  // Se sugiere hueco cuando es reunion o ya hay a quien invitar
  const mostrarSugerencias = fechasEditables && !form.es_global && !todoElDia
    && (form.tipo === 'reunion' || (form.es_compartido && idsParticipantes.length > 0));

  const titulo = !evento ? t('eventNew') : esDuenio ? t('eventEdit') : t('eventDetails');

  // ── Pie fijo: borrar a la izquierda; volver/cancelar y siguiente/guardar ──
  const pie = (
    <div className="agm-pie flex items-center gap-2">
      {evento && esDuenio && (
        <Tooltip label={t('delete')}>
          <button type="button" onClick={() => onDelete(evento)} className="agm-icono agm-icono-peligro" aria-label={t('delete')}>
            <Trash2 size={16} />
          </button>
        </Tooltip>
      )}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          className="agm-boton"
          onClick={() => (conPasos && paso > 1 ? setPaso(paso - 1) : onClose())}
        >
          {conPasos && paso > 1 ? t('back') : esDuenio ? t('cancel') : t('close')}
        </button>

        {/* Siguiente mientras queden pasos; en el ultimo, guardar. Las claves
            distintas hacen que React cree OTRO boton: si reutilizara el mismo y
            le cambiara el type a submit dentro del clic, el navegador enviaria
            el formulario al llegar al ultimo paso (se creaba el evento solo). */}
        {esDuenio && conPasos && paso < PASOS_EVENTO.length ? (
          <button key="siguiente" type="button" className="btn-primary h-9 !py-0 text-[13.5px]" onClick={avanzar}>
            {t('next')} <ChevronRight size={15} />
          </button>
        ) : esDuenio && (
          <button key="guardar" type="submit" form="agm-form-evento" className="btn-primary h-9 !py-0 text-[13.5px]" disabled={cargando}>
            <Save size={15} /> {cargando ? t('saving') : evento ? t('eventUpdateButton') : t('eventCreateButton')}
          </button>
        )}
      </div>
    </div>
  );

  // Indicador de pasos. Solo al crear: para consultar o editar es mas comodo
  // ver todo de corrido.
  const pasos = conPasos && (
    <div className="agm-pasos" aria-label={tx('mod_pasos')}>
      {PASOS_EVENTO.map((item, indice) => {
        const activo = paso === item.id;
        const cumplido = paso > item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => cumplido && setPaso(item.id)}
            disabled={!cumplido}
            aria-current={activo ? 'step' : undefined}
            className="agm-paso"
            data-estado={activo ? 'activo' : cumplido ? 'hecho' : 'pendiente'}
          >
            <span className="agm-paso-numero">{cumplido ? <Check size={11} strokeWidth={3} /> : indice + 1}</span>
            <span className="truncate">{t(item.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );

  // ── Vista de solo lectura (invitado o evento ajeno) ─────────────────────────
  if (!esDuenio) {
    const lugar = esVirtual ? form.url_reunion : form.ubicacion;
    return (
      <Modal open onClose={onClose} maxWidth="560px" title={titulo} footer={pie} bodyClassName="agm-cuerpo">
        <div className="agm-seccion !gap-4">
          <div>
            <span className="agm-chip agm-chip-sm agm-chip-fijo" style={{ '--agm-color': categoria.color }}>
              <span className="agm-chip-punto" /> {nombreCategoria(categoria)}
            </span>
            <h2 className="mt-2 text-[18px] font-semibold leading-snug text-[var(--color-text)]">{form.titulo}</h2>
          </div>

          <dl className="agm-detalle">
            <dt><CalendarDays size={15} aria-label={t('eventDuration')} /></dt>
            <dd>{horarioTexto}</dd>
            {lugar && (<>
              <dt>{esVirtual ? <Video size={15} aria-label={t('eventLinkLabel')} /> : <MapPin size={15} aria-label={t('eventLocation')} />}</dt>
              <dd className="break-words">
                {esVirtual && esUrlHttp(lugar) ? (
                  <a href={lugar} target="_blank" rel="noopener noreferrer" className="agm-enlace">
                    {tx('mod_unirse')} <ExternalLink size={12} />
                  </a>
                ) : lugar}
              </dd>
            </>)}
            {!esVirtual && form.url_reunion && esUrlHttp(form.url_reunion) && (<>
              <dt><Link2 size={15} aria-label={t('eventOptionalLink')} /></dt>
              <dd><a href={form.url_reunion} target="_blank" rel="noopener noreferrer" className="agm-enlace">{tx('mod_unirse')} <ExternalLink size={12} /></a></dd>
            </>)}
            {evento?.proyecto?.nombre && (<>
              <dt><FolderKanban size={15} aria-label={tx('mod_proyecto')} /></dt>
              <dd>{evento.proyecto.nombre}</dd>
            </>)}
            {esRecurrente && (<>
              <dt><Repeat size={15} aria-label={tx('mod_repetir')} /></dt>
              <dd>{tx('mod_serieSemanal')}</dd>
            </>)}
          </dl>

          {form.instrucciones_acceso && (
            <div>
              <span className="agm-etiqueta">{esVirtual ? t('eventInstructions') : t('eventLogistics')}</span>
              <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-[var(--color-text-dim)]">{form.instrucciones_acceso}</p>
            </div>
          )}
          <div>
            <span className="agm-etiqueta">{t('taskDescription')}</span>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-[var(--color-text-dim)]">{form.descripcion || t('taskNoDescription')}</p>
          </div>

          {/* Mi respuesta: lo primero que necesita un invitado */}
          {miRespuesta && (
            <div className="agm-caja agm-caja-suave flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="agm-etiqueta">{tx('mod_tuRespuesta')}</span>
                <p className="mt-0.5 text-[13.5px] font-medium text-[var(--color-text)]">
                  {miRespuesta === 'aceptado' ? tx('mod_rsvpAceptado') : miRespuesta === 'rechazado' ? tx('mod_rsvpRechazado') : tx('mod_rsvpSinResponder')}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="agm-boton agm-boton-rechazo" aria-pressed={miRespuesta === 'rechazado'} disabled={respondiendo} onClick={() => responder('rechazado')}>
                  <X size={14} /> {tx('mod_rsvpNo')}
                </button>
                <button type="button" className="agm-boton agm-boton-exito" aria-pressed={miRespuesta === 'aceptado'} disabled={respondiendo} onClick={() => responder('aceptado')}>
                  <Check size={14} /> {tx('mod_rsvpSi')}
                </button>
              </div>
            </div>
          )}

          {form.es_global ? (
            <p className="agm-nota agm-nota-info"><Globe size={14} /> {t('eventPublicDesc')}</p>
          ) : (organizador || idsParticipantes.length > 0) && (
            <ParticipantesEvento organizador={organizador} invitadosIds={idsParticipantes} usuarios={usuarios} estados={estadosRsvp} />
          )}

          {adjuntosActivos && (
            <TaskAttachments
              tareaId={evento?.id}
              type="agenda"
              title={t('eventDocuments')}
              pendingFiles={archivos}
              onPendingFilesChange={setArchivos}
              showUploader={false}
              showExisting={Boolean(evento?.id)}
            />
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth="720px"
      // Alto fijo mientras se crea: cada paso tiene distinto largo y sin esto la
      // ventana crecia y encogia al avanzar, moviendo los botones de sitio.
      // Al consultar o editar se deja crecer con el contenido. `dvh`: en el
      // móvil la barra del navegador no tapa el pie con los botones.
      height={conPasos ? 'min(700px, 90dvh)' : undefined}
      title={titulo}
      subHeader={pasos ? <div className="agm-pasos-caja">{pasos}</div> : null}
      footer={pie}
      bodyClassName="agm-cuerpo"
    >
      <form id="agm-form-evento" onSubmit={handleSubmit} className="agm-form" noValidate>
        {esRecurrente && (
          <div role="note" className="agm-nota agm-nota-info">
            <Repeat size={14} />
            <span>
              {t('agendaSeriesEditNotice')}
              {patron?.dias?.length > 0 && (
                <> · {tx('mod_serieDias', { dias: patron.dias.map((d) => inicialesSemana[d]?.nombre).filter(Boolean).join(', ') })}</>
              )}
            </span>
          </div>
        )}

        {/* ── Paso 1: lo basico ───────────────────────────────────────── */}
        {enPaso(1) && (<>
          <div className="form-group !mb-0">
            <Etiqueta htmlFor="evento-titulo" texto={t('eventTitleLabel')} />
            <input
              id="evento-titulo"
              className="form-input"
              value={form.titulo}
              onChange={(e) => { setForm({ ...form, titulo: e.target.value }); if (errorTitulo) setErrorTitulo(false); }}
              required
              aria-invalid={errorTitulo}
              placeholder={t('eventTitlePlaceholder')}
              autoFocus={!evento && enfocarAlCargar()}
            />
            {errorTitulo && <p className="agm-error">{t('eventTitleRequired')}</p>}
          </div>

          <div className="form-group !mb-0">
            <Etiqueta id="evento-tipo-label" texto={t('eventCategory')} />
            <div className="agm-chips" role="group" aria-labelledby="evento-tipo-label">
              {CATEGORIAS_EVENTO.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="agm-chip"
                  style={{ '--agm-color': c.color }}
                  aria-pressed={form.tipo === c.id}
                  onClick={() => elegirCategoria(c.id)}
                >
                  <span className="agm-chip-punto" /> {nombreCategoria(c)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="form-group !mb-0">
              <Etiqueta htmlFor="evento-fechas" texto={t('eventDuration')} />
              {fechasEditables ? (
                // Calendario plegado en linea. Antes abria una ventana sobre la
                // ventana del evento; ya no se usan modales para esto.
                <SelectorRangoFechas
                  id="evento-fechas"
                  plegable
                  conLeyenda={false}
                  desde={form.fecha_inicio}
                  hasta={form.fecha_fin && form.fecha_fin !== form.fecha_inicio ? form.fecha_fin : ''}
                  onChange={({ desde, hasta }) => setForm((prev) => ({
                    ...prev,
                    fecha_inicio: desde,
                    // Un evento de un solo dia comparte inicio y fin
                    fecha_fin: hasta || desde,
                  }))}
                />
              ) : (
                <div id="evento-fechas" className="agm-campo agm-campo-lectura">
                  {fechaInicioTexto}{variosDias ? ` – ${fechaFinTexto}` : ''}
                </div>
              )}
            </div>

            <div className="form-group !mb-0">
              <Etiqueta htmlFor="evento-horas" texto={t('eventSelectTime')} />
              {fechasEditables && !todoElDia ? (
                // Inicio y fin encadenados (como Google Calendar): el fin solo
                // ofrece horas posteriores con su duracion, y mover el inicio
                // conserva la duracion. Si el evento abarca varios dias, el fin
                // es una hora libre del ultimo dia.
                <SelectorRangoHoras
                  id="evento-horas"
                  inicio={form.hora_inicio}
                  fin={form.hora_fin}
                  mismoDia={!variosDias}
                  etiquetaInicio={t('eventFrom')}
                  etiquetaFin={t('eventTo')}
                  onCambio={({ inicio, fin }) => setForm((prev) => ({ ...prev, hora_inicio: inicio, hora_fin: fin }))}
                />
              ) : (
                <div id="evento-horas" className="agm-campo agm-campo-lectura">
                  {todoElDia ? tx('mod_todoElDia') : rangoHorasTexto}
                </div>
              )}
            </div>
          </div>

          {fechasEditables && (
            <label className="agm-interruptor">
              <span>
                <span className="agm-interruptor-titulo">{tx('mod_todoElDia')}</span>
                <span className="agm-ayuda">{tx('mod_todoElDiaAyuda')}</span>
              </span>
              <Switch
                checked={todoElDia}
                disabled={esDiaCompleto}
                onCheckedChange={(valor) => setForm((prev) => ({ ...prev, todo_el_dia: valor }))}
              />
            </label>
          )}

          {/* Repeticion semanal: solo al crear (una serie ya creada se edita
              entera y sus fechas no se tocan desde aqui) */}
          {!evento && (
            <div className="agm-caja agm-seccion">
              <label className="agm-interruptor !border-0 !p-0">
                <span>
                  <span className="agm-interruptor-titulo flex items-center gap-1.5"><Repeat size={14} /> {tx('mod_repetir')}</span>
                  <span className="agm-ayuda">{tx('mod_repetirAyuda')}</span>
                </span>
                <Switch checked={form.repetir} onCheckedChange={toggleRepetir} />
              </label>
              {form.repetir && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="agm-dias-semana" role="group" aria-label={tx('mod_repetirDias')}>
                    {semanaLunes.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={form.repetir_dias.includes(d.id)}
                        aria-label={d.nombre}
                        title={d.nombre}
                        onClick={() => toggleDiaRepeticion(d.id)}
                      >
                        {d.inicial}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-col gap-1">
                    <Etiqueta htmlFor="evento-repetir-hasta" texto={tx('mod_repetirHasta')} opcional />
                    <input
                      id="evento-repetir-hasta"
                      type="date"
                      className="form-input !w-auto"
                      min={form.fecha_inicio || undefined}
                      value={form.repetir_hasta}
                      onChange={(e) => setForm({ ...form, repetir_hasta: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="form-group !mb-0">
            <Etiqueta id="evento-aviso-label" texto={tx('mod_aviso')} icono={<Bell size={14} />} />
            <div className="agm-chips" role="group" aria-labelledby="evento-aviso-label">
              {AVISOS_EVENTO.map((a) => (
                <button
                  key={a.minutos}
                  type="button"
                  className="agm-chip agm-chip-sm"
                  aria-pressed={Number(form.alerta_minutos) === a.minutos}
                  onClick={() => setForm({ ...form, alerta_minutos: a.minutos })}
                >
                  {tx(a.textoKey, { n: a.n })}
                </button>
              ))}
            </div>
          </div>

          <div className="form-group !mb-0">
            <Etiqueta htmlFor="evento-descripcion" texto={t('taskDescription')} opcional />
            <textarea
              id="evento-descripcion"
              className="form-input min-h-[76px] resize-y"
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              placeholder={t('eventDescriptionPlaceholder')}
            />
          </div>

          {evento?.proyecto?.nombre && (
            <p className="agm-ayuda flex items-center gap-1.5"><FolderKanban size={13} /> {tx('mod_vinculadoProyecto', { proyecto: evento.proyecto.nombre })}</p>
          )}
        </>)}

        {/* ── Paso 2: donde ocurre ────────────────────────────────────── */}
        {enPaso(2) && (<>
          {!conPasos && <hr className="agm-separador" />}
          <div className="form-group !mb-0">
            <Etiqueta id="evento-modalidad-label" texto={t('eventModality')} />
            <div className="agm-segmento" role="group" aria-labelledby="evento-modalidad-label">
              <button type="button" aria-pressed={!esVirtual} onClick={() => setForm({ ...form, modalidad: 'presencial' })}>
                <MapPin size={14} /> {t('eventInPerson')}
              </button>
              <button type="button" aria-pressed={esVirtual} onClick={() => setForm({ ...form, modalidad: 'virtual' })}>
                <Video size={14} /> {t('eventRemote')}
              </button>
            </div>
          </div>

          {esVirtual ? (
            <div className="form-group !mb-0">
              <Etiqueta htmlFor="evento-lugar" texto={t('eventLinkLabel')} icono={<Link2 size={14} />} />
              <EnlaceReunion
                id="evento-lugar"
                valor={form.url_reunion}
                onChange={(valor) => setForm((prev) => ({ ...prev, url_reunion: valor }))}
                placeholder={t('eventLinkPlaceholder')}
                showToast={showToast}
              />
            </div>
          ) : (<>
            <div className="form-group !mb-0">
              <Etiqueta htmlFor="evento-lugar" texto={t('eventLocation')} icono={<MapPin size={14} />} opcional />
              <input
                id="evento-lugar"
                className="form-input"
                value={form.ubicacion}
                onChange={(e) => setForm({ ...form, ubicacion: e.target.value })}
                placeholder={t('eventLocationPlaceholder')}
              />
            </div>
            <div className="form-group !mb-0">
              <Etiqueta htmlFor="evento-enlace-opcional" texto={t('eventOptionalLink')} icono={<Video size={14} />} opcional />
              <EnlaceReunion
                id="evento-enlace-opcional"
                valor={form.url_reunion}
                onChange={(valor) => setForm((prev) => ({ ...prev, url_reunion: valor }))}
                placeholder={t('eventOptionalRemotePlaceholder')}
                conAtajos={false}
                showToast={showToast}
              />
            </div>
          </>)}

          {/* La nota va sola a lo ancho: es el unico campo de varias lineas */}
          <div className="form-group !mb-0">
            <Etiqueta htmlFor="evento-instrucciones" texto={esVirtual ? t('eventInstructions') : t('eventLogistics')} opcional />
            <textarea
              id="evento-instrucciones"
              className="form-input min-h-[76px] resize-y"
              value={form.instrucciones_acceso}
              onChange={(e) => setForm({ ...form, instrucciones_acceso: e.target.value })}
              placeholder={esVirtual ? t('eventVirtualAccessPlaceholder') : t('eventInPersonAccessPlaceholder')}
            />
          </div>

          {puedeLigarCliente && esDuenio && (
            <SelectorClienteEvento valor={form.empresa_id} onCambio={(v) => setForm({ ...form, empresa_id: v })} />
          )}
        </>)}

        {/* ── Paso 3: quien participa ─────────────────────────────────── */}
        {enPaso(3) && (<>
          {!conPasos && <hr className="agm-separador" />}

          {/* Recordatorio del horario elegido: en este paso ya no se ve el
              calendario y los huecos sugeridos lo cambian. */}
          <div className="agm-resumen">
            <CalendarDays size={15} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{horarioTexto}</span>
            {conPasos && (
              <button type="button" className="agm-enlace" onClick={() => setPaso(1)}>{tx('mod_cambiar')}</button>
            )}
          </div>

          <label className="agm-interruptor">
            <span className="flex min-w-0 items-start gap-2.5">
              <span>
                <span id="evento-compartir-label" className="agm-interruptor-titulo">{t('eventCollaboration')}</span>
                <span id="evento-compartir-desc" className="agm-ayuda">{t('eventCollaborationDesc')}</span>
              </span>
            </span>
            <Switch
              checked={!!form.es_compartido}
              onCheckedChange={(valor) => setForm((prev) => ({ ...prev, es_compartido: valor }))}
              aria-label={t('agendaShareSwitch')}
              aria-describedby="evento-compartir-desc"
            />
          </label>

          {form.es_compartido && (<>
            {puedeElegirGlobal && (
              <div className="agm-segmento" role="group" aria-label={t('eventCollaboration')}>
                <button type="button" aria-pressed={!form.es_global} onClick={() => setForm({ ...form, es_global: false })}>
                  {t('eventSpecificMembers')}
                </button>
                <button type="button" aria-pressed={!!form.es_global} onClick={() => setForm({ ...form, es_global: true, invitados_ids: [] })}>
                  <Globe size={14} /> {t('eventAllTeam')}
                </button>
              </div>
            )}

            {!form.es_global ? (<>
              {/* Campo que se despliega, con buscador; los elegidos salen
                  debajo con su foto y su respuesta. */}
              <div className="form-group !mb-0">
                <Etiqueta id="evento-invitados-label" texto={t('eventSelectMembers')} />
                <div role="group" aria-labelledby="evento-invitados-label">
                  <SelectorMultiple
                    conBuscador
                    placeholder={t('eventPickMembers')}
                    vacioTexto={t('eventNoMembers')}
                    seleccionados={form.invitados_ids}
                    onToggle={togggleInvitado}
                    opciones={miembrosElegibles.map((u) => ({ valor: u.id, etiqueta: u.nombre }))}
                  />
                </div>
              </div>

              {idsParticipantes.length > 0 && (
                <ParticipantesEvento
                  organizador={organizador}
                  invitadosIds={idsParticipantes}
                  usuarios={usuarios}
                  estados={estadosRsvp}
                  ocupados={idsOcupados}
                  onQuitar={togggleInvitado}
                />
              )}

              {/* Estado del horario elegido para los invitados */}
              {dispComprobada && (disponibilidad.length > 0 ? (
                <div className="agm-nota agm-nota-aviso !block" role="status">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle size={14} /> {t('eventConflicts')} ({disponibilidad.length})
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {disponibilidad.slice(0, 4).map((d, idx) => {
                      const persona = usuarios.find((u) => u.id === d.usuarioId)?.nombre;
                      // Proyectos, tareas y bloques de un dia entero no tienen
                      // una hora util: "Ocupado de 06:00 p. m." confundia.
                      const largo = d.fechaFin ? new Date(d.fechaFin) - new Date(d.fechaInicio) : 0;
                      const sinHora = d.tipo === 'proyecto' || d.tipo === 'tarea' || largo >= 20 * 3600000;
                      const desdeTxt = new Date(d.fechaInicio).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
                      const hastaTxt = d.fechaFin ? new Date(d.fechaFin).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '';
                      return (
                        <li key={`disp-${d.id || idx}`} className="agm-conflicto">
                          {persona && <strong>{persona}</strong>}{' '}
                          {sinHora ? tx('mod_ocupadoDia') : <>{t('eventBusyFrom')} {desdeTxt}{hastaTxt && ` – ${hastaTxt}`}</>}
                          {d.titulo && d.titulo !== 'Ocupado' && <span className="opacity-80"> · {d.titulo}</span>}
                        </li>
                      );
                    })}
                    {disponibilidad.length > 4 && <li className="agm-conflicto">{tx('mod_yMas', { n: disponibilidad.length - 4 })}</li>}
                  </ul>
                  {mostrarSugerencias && <p className="mt-1.5">{tx('mod_conflictoSugerencia')}</p>}
                </div>
              ) : (
                <p className="agm-nota agm-nota-exito" role="status"><CheckCircle2 size={14} /> {tx('mod_todosLibres')}</p>
              ))}
            </>) : (
              <p className="agm-nota agm-nota-info">
                <Globe size={14} />
                <span><strong>{t('eventPublicLabel')}.</strong> {t('eventPublicDesc')}</span>
              </p>
            )}
          </>)}

          {mostrarSugerencias && (
            <SugerirHorario
              invitadosIds={form.es_compartido ? idsParticipantes : []}
              fechaDesde={form.fecha_inicio}
              horaInicio={form.hora_inicio}
              horaFin={form.hora_fin}
              fechaElegida={form.fecha_inicio === form.fecha_fin ? form.fecha_inicio : null}
              excluirId={evento?.id}
              onElegir={({ fecha, horaInicio, horaFin }) => setForm((prev) => ({
                ...prev,
                fecha_inicio: fecha,
                fecha_fin: fecha,
                hora_inicio: horaInicio,
                hora_fin: horaFin,
              }))}
            />
          )}

          {/* Los documentos cierran el paso 3: son lo mas opcional de todo */}
          {adjuntosActivos && (
            <TaskAttachments
              tareaId={evento?.id}
              type="agenda"
              title={`${t('eventDocuments')} · ${t('fieldOptional')}`}
              pendingFiles={archivos}
              onPendingFilesChange={setArchivos}
              showUploader
              showExisting={Boolean(evento?.id)}
              uploadLabel={evento ? t('projectAddFiles') : t('projectSelectFiles')}
            />
          )}
        </>)}
      </form>
    </Modal>
  );
};

export default ModalEvento;
