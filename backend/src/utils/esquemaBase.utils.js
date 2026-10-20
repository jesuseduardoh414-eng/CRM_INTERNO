// Tablas, columnas y relaciones de la base, sacadas del esquema de Prisma
// (DMMF). Las usan la copia entre bases (scripts/copiar_base.js) y los
// respaldos (services/respaldo.service.js): no hay listas de tablas escritas a
// mano que se desincronicen al agregar modelos.
const { Prisma } = require('@prisma/client');

const modelos = Prisma.dmmf.datamodel.models;
const porNombre = new Map(modelos.map((m) => [m.name, m]));
const tablaDe = (modelo) => modelo.dbName || modelo.name;
const columnaDe = (campo) => campo.dbName || campo.name;
const camposEscalares = (modelo) => modelo.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');
const relacionesConFk = (modelo) => modelo.fields.filter((f) => f.kind === 'object' && f.relationFromFields?.length);
const campoId = (modelo) => modelo.fields.find((f) => f.isId);
const nombreCliente = (modelo) => modelo.name[0].toLowerCase() + modelo.name.slice(1);
const esAutoincremental = (campo) => campo.default?.name === 'autoincrement';

/** Tablas intermedias de las relaciones muchos-a-muchos implicitas (_Nombre, columnas A y B). */
const tablasM2M = () => {
  const vistas = new Set();
  const lista = [];
  for (const modelo of modelos) {
    for (const campo of modelo.fields) {
      if (campo.kind !== 'object' || !campo.isList || campo.relationFromFields?.length) continue;
      const otro = porNombre.get(campo.type);
      const inversa = otro.fields.find((f) => f.kind === 'object' && f.relationName === campo.relationName && !(otro === modelo && f.name === campo.name));
      if (!inversa || !inversa.isList || inversa.relationFromFields?.length) continue;
      if (vistas.has(campo.relationName)) continue;
      vistas.add(campo.relationName);
      // Prisma pone en A el modelo que va primero alfabeticamente.
      const [modeloA, modeloB] = [modelo.name, otro.name].sort();
      lista.push({ tabla: `_${campo.relationName}`, modeloA, modeloB });
    }
  }
  return lista;
};

module.exports = {
  modelos,
  porNombre,
  tablaDe,
  columnaDe,
  camposEscalares,
  relacionesConFk,
  campoId,
  nombreCliente,
  esAutoincremental,
  tablasM2M,
};
