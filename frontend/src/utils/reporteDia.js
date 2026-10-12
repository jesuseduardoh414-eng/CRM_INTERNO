/**
 * Reporte imprimible de la actividad de un día.
 *
 * El documento se arma como HTML dentro de un iframe oculto y se manda a
 * imprimir: el navegador ofrece "Guardar como PDF" y así no hace falta ninguna
 * librería de PDF ni un endpoint aparte. Se usa un iframe en vez de una pestaña
 * nueva porque no lo bloquea el antipop-ups y no deja pestañas huérfanas.
 *
 * `filas` viene ya recortado por quien llama: solo las personas que cerraron al
 * menos una tarea ese día, en el orden en que deben salir impresas.
 */

import { fechaLocalDesdeISO } from './fechasLocales';

const escapar = (valor) => String(valor ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Papel blanco y tinta negra a propósito: el reporte se imprime o se guarda en
// PDF, así que aquí no aplican las variables de tema de la aplicación.
const ESTILOS = `
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
    font-size: 11px;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Cabecera con la marca OMNIS: marino #10233f y una linea dorada. El logo
     va como imagen del propio sitio (misma origen que el iframe de impresion). */
  .cabecera {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
    border-bottom: 2px solid #10233f; padding-bottom: 10px; margin-bottom: 18px;
  }
  .cabecera .marca { flex-shrink: 0; height: 30px; width: auto; }
  .cabecera h1 { margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; color: #10233f; }
  .cabecera .fecha { margin: 3px 0 0; font-size: 12px; color: #374151; }
  .cabecera .filtro { margin: 6px 0 0; font-size: 10px; color: #6b7280; }

  /* Nada de break-inside: avoid en el bloque de una persona: quien tiene
     muchas tareas no cabe en una hoja y el navegador empujaba el bloque entero
     a la pagina siguiente, dejando la primera en blanco. Ahora la lista fluye
     y solo se protege que no se parta una fila ni un titulo de su tabla. */
  .persona { margin-bottom: 18px; }
  tr { break-inside: avoid; page-break-inside: avoid; }

  table { width: 100%; border-collapse: collapse; }
  /* display: table-header-group hace que el navegador repita la cabecera en
     cada pagina, asi que en una lista larga el nombre sigue a la vista. */
  thead { display: table-header-group; break-inside: avoid; break-after: avoid; }
  th { padding: 0; font-weight: 400; text-align: left; }

  .cab-persona th { padding: 0 0 4px; border-bottom: 1px solid #d1d5db; }
  .persona-cab {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  }
  .persona-cab .nombre { font-size: 13px; font-weight: 600; }
  .persona-cab .area { font-size: 10px; color: #6b7280; font-weight: 400; margin-left: 6px; }
  .persona-cab .conteo { font-size: 10px; color: #374151; white-space: nowrap; }

  .cab-bloque th {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em;
    color: #6b7280; font-weight: 600; padding: 8px 0 3px;
  }

  td { padding: 3px 0; vertical-align: top; border-bottom: 1px solid #f3f4f6; }
  td.tarea { width: auto; }
  td.proyecto { width: 26%; color: #6b7280; padding-left: 10px; }
  td.dato { width: 86px; text-align: right; color: #6b7280; white-space: nowrap; }
  .curso td { color: #4b5563; }

  .vacio { color: #6b7280; font-style: italic; padding: 24px 0; }
  .pie {
    margin-top: 20px; padding-top: 8px; border-top: 1px solid #d1d5db;
    font-size: 10px; color: #6b7280; display: flex; justify-content: space-between; gap: 12px;
  }
`;

const filaTarea = (tarea, dato, clase = '') => `
  <tr class="${clase}">
    <td class="tarea">${escapar(tarea.titulo)}</td>
    <td class="proyecto">${escapar(tarea.proyecto?.nombre || '—')}</td>
    <td class="dato">${escapar(dato || '')}</td>
  </tr>`;

/**
 * Documento completo del reporte. Va aparte de la impresión para poder
 * revisarlo sin navegador de por medio.
 *
 * @param {object} opciones
 * @param {Array}  opciones.filas    [{ miembro, hechas, enProgreso }]
 * @param {object} opciones.textos   etiquetas ya traducidas
 * @param {string} opciones.locale   para formatear horas y fechas
 * @param {string} opciones.logoUrl  logo de la cabecera (ruta del propio sitio)
 */
export const construirHtmlReporte = ({ filas = [], textos = {}, locale = 'es-MX', logoUrl = '/brand/omnis-horizontal-azul.png' }) => {
  // Las etiquetas llegan como plantillas ('Terminadas: {count}') y aquí se
  // rellenan con los totales. Con respaldo vacío para que una etiqueta que
  // falte deje un hueco y no rompa la impresión a medias.
  const plantilla = (clave) => String(textos[clave] ?? '');

  const hora = (valor) => (valor
    ? new Date(valor).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : '');
  // En el bloque de "en curso" la fecha sola no dice nada, así que va con su
  // etiqueta ("Vence 14 ago"); en el de terminadas basta la hora de cierre.
  // El vencimiento es un día de calendario: con `new Date(iso)` podía salir
  // corrido un día según el huso horario (utils/fechasLocales).
  const vence = (valor) => {
    const fecha = fechaLocalDesdeISO(valor);
    return fecha
      ? plantilla('vence').replace('{fecha}', fecha.toLocaleDateString(locale, { day: '2-digit', month: 'short' }))
      : '';
  };

  const totalTareas = filas.reduce((suma, fila) => suma + fila.hechas.length, 0);

  const cuerpo = filas.length === 0
    ? `<p class="vacio">${escapar(textos.vacio)}</p>`
    : filas.map(({ miembro, hechas, enProgreso }) => {
      // La ficha de la persona va dentro del <thead> de su tabla y no suelta
      // encima: así el navegador la repinta en cada página cuando la lista es
      // larga, y no se pierde de quién son las tareas.
      const conteo = `${plantilla('conteoHechas').replace('{count}', hechas.length)}${
        enProgreso.length
          ? ` · ${plantilla('conteoEnCurso').replace('{count}', enProgreso.length)}`
          : ''
      }`;

      const cabPersona = `
        <tr class="cab-persona"><th colspan="3">
          <div class="persona-cab">
            <div>
              <span class="nombre">${escapar(miembro.nombre)}</span>
              ${miembro.area ? `<span class="area">${escapar(textos.areas?.[miembro.area] || miembro.area)}</span>` : ''}
            </div>
            <div class="conteo">${escapar(conteo)}</div>
          </div>
        </th></tr>`;

      const cabBloque = (titulo) => `<tr class="cab-bloque"><th colspan="3">${escapar(titulo)}</th></tr>`;

      return `
      <section class="persona">
        <table>
          <thead>${cabPersona}${cabBloque(plantilla('tituloHechas'))}</thead>
          <tbody>${hechas.map((tarea) => filaTarea(tarea, hora(tarea.completadoEn))).join('')}</tbody>
        </table>

        ${enProgreso.length ? `
          <table>
            <thead>${cabBloque(plantilla('tituloEnCurso'))}</thead>
            <tbody>${enProgreso.map((tarea) => filaTarea(tarea, vence(tarea.venceEn), 'curso')).join('')}</tbody>
          </table>
        ` : ''}
      </section>`;
    }).join('');

  return `<!doctype html>
<html lang="${escapar(locale.slice(0, 2))}">
<head>
  <meta charset="utf-8" />
  <title>${escapar(textos.titulo)} · ${escapar(textos.fechaLegible)}</title>
  <style>${ESTILOS}</style>
</head>
<body>
  <header class="cabecera">
    <div>
      <h1>${escapar(textos.titulo)}</h1>
      <p class="fecha">${escapar(textos.fechaLegible)}</p>
      ${textos.filtroProyecto ? `<p class="filtro">${escapar(textos.filtroProyecto)}</p>` : ''}
    </div>
    <img class="marca" src="${escapar(logoUrl)}" alt="OMNIS" />
  </header>

  ${cuerpo}

  <footer class="pie">
    <span>${escapar(plantilla('pie')
      .replace('{personas}', filas.length)
      .replace('{tareas}', totalTareas))}</span>
    <span>${escapar(textos.generado)}</span>
  </footer>
</body>
</html>`;
};

// iPhone/iPad (también el iPad que se anuncia como Mac): Safari en iOS ignora
// el `print()` de un iframe oculto o imprime la página de atrás en su lugar.
const esIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * En iOS el reporte se abre en una pestaña propia y se imprime desde ahí; el
 * usuario guarda el PDF con "Compartir → Imprimir". Se llama dentro del clic,
 * así que el navegador no lo trata como ventana emergente. Devuelve false si
 * aun así se bloqueó, para caer al iframe.
 */
const imprimirEnPestana = (html) => {
  const ventana = window.open('', '_blank');
  if (!ventana) return false;
  ventana.document.open();
  ventana.document.write(html);
  ventana.document.close();
  // Se espera a que cargue el logo; si no, la hoja sale sin él. El listener va
  // después de close(): document.open() borra los que hubiera en la ventana.
  const imprimir = () => { ventana.focus(); ventana.print(); };
  if (ventana.document.readyState === 'complete') imprimir();
  else ventana.addEventListener('load', imprimir, { once: true });
  return true;
};

/** Manda el reporte al diálogo de impresión del navegador ("Guardar como PDF"). */
export const imprimirReporteDia = (opciones) => {
  const html = construirHtmlReporte(opciones);
  if (esIOS() && imprimirEnPestana(html)) return;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  // El documento es HTML nuestro sin scripts: se aisla igual. `allow-modals`
  // es lo que permite abrir el diálogo de impresión; `allow-same-origin` deja
  // escuchar `afterprint` desde aquí.
  iframe.setAttribute('sandbox', 'allow-modals allow-same-origin');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';

  let retirado = false;
  const retirar = () => {
    if (retirado) return;
    retirado = true;
    iframe.remove();
  };

  iframe.onload = () => {
    const ventana = iframe.contentWindow;
    if (!ventana) {
      retirar();
      return;
    }
    // El iframe se quita cuando el navegador avisa que terminó de imprimir.
    // Firefox y Safari devuelven el control de `print()` antes de renderizar
    // el documento: con un temporizador corto imprimían una hoja en blanco.
    // El tope de 60 s es por si el aviso nunca llega.
    ventana.addEventListener('afterprint', retirar);
    window.setTimeout(retirar, 60000);
    ventana.focus();
    ventana.print();
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
};

export default imprimirReporteDia;
