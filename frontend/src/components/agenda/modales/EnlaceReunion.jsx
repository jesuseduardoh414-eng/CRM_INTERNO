import { ExternalLink, ClipboardPaste, Video } from 'lucide-react';
import { useTextoAgenda } from '../../../hooks/useTextoAgenda';
import { PLATAFORMAS_VIDEO, esUrlHttp, plataformaDeEnlace } from './catalogos';

/**
 * Campo del enlace de videollamada: valida en vivo, ofrece abrirlo y trae
 * atajos para crear la sala en Meet, Zoom o Teams y pegar el enlace.
 */
const EnlaceReunion = ({ id, valor, onChange, placeholder, conAtajos = true, showToast }) => {
  const tx = useTextoAgenda();
  const texto = String(valor || '').trim();
  const valido = esUrlHttp(texto);
  const invalido = texto !== '' && !valido;
  const plataforma = valido ? plataformaDeEnlace(texto) : null;

  // El portapapeles puede estar bloqueado (permiso o http): entonces se avisa
  // y el usuario lo pega a mano.
  const pegar = async () => {
    try {
      const pegado = (await navigator.clipboard.readText()).trim();
      if (!esUrlHttp(pegado)) {
        showToast?.(tx('mod_portapapelesSinEnlace'), 'error');
        return;
      }
      onChange(pegado);
    } catch {
      showToast?.(tx('mod_portapapelesBloqueado'), 'error');
    }
  };

  return (
    <div className="agm-seccion">
      <div className="flex gap-2">
        <input
          id={id}
          className="form-input min-w-0 flex-1"
          type="url"
          inputMode="url"
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={invalido}
          aria-describedby={invalido ? `${id}-error` : undefined}
        />
        {valido ? (
          <a href={texto} target="_blank" rel="noopener noreferrer" className="agm-boton shrink-0 self-stretch">
            <ExternalLink size={14} aria-hidden="true" /> {tx('mod_abrir')}
          </a>
        ) : (
          <button type="button" onClick={pegar} className="agm-boton shrink-0 self-stretch">
            <ClipboardPaste size={14} aria-hidden="true" /> {tx('mod_pegar')}
          </button>
        )}
      </div>

      {invalido && <p id={`${id}-error`} className="agm-error">{tx('mod_enlaceInvalido')}</p>}
      {plataforma && (
        <p className="agm-ayuda flex items-center gap-1.5"><Video size={13} aria-hidden="true" /> {tx('mod_enlaceDe', { plataforma })}</p>
      )}

      {conAtajos && !texto && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="agm-ayuda">{tx('mod_crearSalaEn')}</span>
          {PLATAFORMAS_VIDEO.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" className="agm-chip agm-chip-sm">
              {p.nombre} <ExternalLink size={11} aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default EnlaceReunion;
