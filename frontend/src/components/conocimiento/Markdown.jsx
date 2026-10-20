// Texto con formato básico tipo Markdown de la base de conocimiento, pintado
// como elementos de React (nunca como HTML: no hay forma de colar un script).
//
// Bloques: # / ## / ### títulos, - o * listas, 1. listas numeradas, > citas,
// ``` bloques de código, --- separador y párrafos (un salto de línea dentro
// de un párrafo se respeta). En línea: **negrita**, *cursiva* o _cursiva_,
// `código`, [texto](enlace) y direcciones sueltas (https://…). Solo se
// enlazan http(s), mailto y rutas internas (/conocimiento/3).
import { Fragment, useMemo } from 'react';
import { Link } from 'react-router-dom';

const ENLACE_SEGURO = /^(https?:\/\/|mailto:|\/(?!\/))/i;
const EN_LINEA = /(\*\*([^*]+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*\s](?:[^*]*[^*\s])?)\*)|(\b_([^_\s](?:[^_]*[^_\s])?)_\b)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

const Enlace = ({ href, children }) => {
  if (!ENLACE_SEGURO.test(href)) return <>{children}</>;
  if (href.startsWith('/')) return <Link to={href} className="cli-enlace">{children}</Link>;
  return <a href={href} target="_blank" rel="noopener noreferrer" className="cli-enlace">{children}</a>;
};

/** Texto de una línea -> nodos con negritas, cursivas, código y enlaces. */
const enLinea = (texto, clave = 'l') => {
  const nodos = [];
  let ultimo = 0;
  let n = 0;
  // Una expresión propia por llamada: con la compartida, la llamada anidada
  // (el texto de una negrita) reiniciaba la posición de esta y el bucle no acababa.
  const re = new RegExp(EN_LINEA.source, 'g');
  let m = re.exec(texto);
  while (m) {
    if (m.index > ultimo) nodos.push(texto.slice(ultimo, m.index));
    const k = `${clave}-${n}`;
    if (m[1]) nodos.push(<strong key={k}>{enLinea(m[2], k)}</strong>);
    else if (m[3]) nodos.push(<code key={k} className="con-codigo">{m[4]}</code>);
    else if (m[5]) nodos.push(<Enlace key={k} href={m[7]}>{enLinea(m[6], k)}</Enlace>);
    else if (m[8]) nodos.push(<em key={k}>{enLinea(m[9], k)}</em>);
    else if (m[10]) nodos.push(<em key={k}>{enLinea(m[11], k)}</em>);
    else if (m[12]) nodos.push(<Enlace key={k} href={m[12]}>{m[12]}</Enlace>);
    ultimo = m.index + m[0].length;
    n += 1;
    m = re.exec(texto);
  }
  if (ultimo < texto.length) nodos.push(texto.slice(ultimo));
  return nodos;
};

/** Varias líneas de un párrafo, con sus saltos. */
const conSaltos = (lineas, clave) => lineas.map((linea, i) => (
  <Fragment key={i}>{i > 0 && <br />}{enLinea(linea, `${clave}-${i}`)}</Fragment>
));

/** Texto completo -> lista de bloques { tipo, ... }. */
const bloques = (texto) => {
  const lineas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const salida = [];
  let i = 0;
  const es = (re) => i < lineas.length && re.test(lineas[i]);
  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) { i += 1; continue; }
    if (/^```/.test(linea)) {
      const codigo = [];
      i += 1;
      while (i < lineas.length && !/^```/.test(lineas[i])) { codigo.push(lineas[i]); i += 1; }
      i += 1;
      salida.push({ tipo: 'codigo', texto: codigo.join('\n') });
      continue;
    }
    const titulo = /^(#{1,3})\s+(.*)$/.exec(linea);
    if (titulo) { salida.push({ tipo: 'titulo', nivel: titulo[1].length, texto: titulo[2] }); i += 1; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(linea)) { salida.push({ tipo: 'separador' }); i += 1; continue; }
    if (/^\s*[-*]\s+/.test(linea)) {
      const items = [];
      while (es(/^\s*[-*]\s+/)) { items.push(lineas[i].replace(/^\s*[-*]\s+/, '')); i += 1; }
      salida.push({ tipo: 'lista', items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(linea)) {
      const items = [];
      const inicio = Number(/^\s*(\d+)/.exec(linea)[1]);
      while (es(/^\s*\d+[.)]\s+/)) { items.push(lineas[i].replace(/^\s*\d+[.)]\s+/, '')); i += 1; }
      salida.push({ tipo: 'numerada', items, inicio });
      continue;
    }
    if (/^\s*>/.test(linea)) {
      const citas = [];
      while (es(/^\s*>/)) { citas.push(lineas[i].replace(/^\s*>\s?/, '')); i += 1; }
      salida.push({ tipo: 'cita', lineas: citas });
      continue;
    }
    const parrafo = [];
    while (i < lineas.length && lineas[i].trim() && !/^(#{1,3}\s|```|\s*[-*]\s+|\s*\d+[.)]\s+|\s*>|\s*(-{3,}|\*{3,})\s*$)/.test(lineas[i])) {
      parrafo.push(lineas[i]);
      i += 1;
    }
    salida.push({ tipo: 'parrafo', lineas: parrafo });
  }
  return salida;
};

const Markdown = ({ texto, className = '' }) => {
  const contenido = useMemo(() => bloques(texto).map((b, i) => {
    const k = `b${i}`;
    switch (b.tipo) {
      case 'titulo': {
        const Etiqueta = b.nivel === 1 ? 'h2' : b.nivel === 2 ? 'h3' : 'h4';
        return <Etiqueta key={k}>{enLinea(b.texto, k)}</Etiqueta>;
      }
      case 'lista':
        return <ul key={k}>{b.items.map((it, j) => <li key={`${k}-${j}`}>{enLinea(it, `${k}-${j}`)}</li>)}</ul>;
      case 'numerada':
        return <ol key={k} start={b.inicio}>{b.items.map((it, j) => <li key={`${k}-${j}`}>{enLinea(it, `${k}-${j}`)}</li>)}</ol>;
      case 'cita':
        return <blockquote key={k}>{conSaltos(b.lineas, k)}</blockquote>;
      case 'codigo':
        return <pre key={k}><code>{b.texto}</code></pre>;
      case 'separador':
        return <hr key={k} />;
      default:
        return <p key={k}>{conSaltos(b.lineas, k)}</p>;
    }
  }), [texto]);
  return <div className={`con-markdown ${className}`}>{contenido}</div>;
};

export default Markdown;
