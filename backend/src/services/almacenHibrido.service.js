/**
 * Archivos privados del CRM en Google Drive o en el disco del servidor.
 *
 * Lo usan los almacenes de adjuntos, comprobantes, contratos, cotizaciones y
 * base de conocimiento (las fotos de perfil se quedan siempre en el disco:
 * pesan poco y se cargan a cada rato). Reglas:
 *  - Con Drive conectado (drive.service.js) los archivos nuevos van a Drive.
 *    Si Drive falla al guardar, el archivo se guarda en el disco para no
 *    perderlo y la tarea diaria (o el boton del panel) lo sube despues.
 *  - Al leer se busca en Drive y, si no esta, en el disco: asi siguen
 *    funcionando los archivos de antes de conectar Drive.
 *  - Al borrar se manda a la papelera de Drive (30 dias para recuperarlo) y
 *    se borra del disco.
 * Los nombres internos los valida cada almacen con su `rutaDe` antes de tocar
 * Drive o el disco.
 */
const fs = require('fs/promises');
const path = require('path');
const drive = require('./drive.service');

// Almacenes registrados, para pasar a Drive lo que haya quedado en el disco.
const registrados = [];

/**
 * clave: subcarpeta de Drive (drive.service SUBCARPETAS); rutaDe(nombre):
 * ruta en disco (lanza si el nombre no es valido); asegurarDirectorio():
 * crea la carpeta del disco; directorio(): la carpeta; tipoDe(nombre): mime
 * por la extension; esNombre(nombre): si un archivo del disco es de este
 * almacen.
 */
const crearAlmacenHibrido = (definicion) => {
  const { clave, rutaDe, asegurarDirectorio } = definicion;
  registrados.push(definicion);

  const guardarEnDisco = async (nombre, buffer) => {
    await asegurarDirectorio();
    await fs.writeFile(rutaDe(nombre), buffer, { flag: 'wx', mode: 0o600 });
    return 'disco';
  };

  return {
    /** Guarda el archivo; devuelve 'drive' o 'disco'. */
    guardar: async (nombre, buffer, mime) => {
      rutaDe(nombre);
      if (await drive.activo()) {
        try {
          await drive.subir(clave, nombre, buffer, mime);
          return 'drive';
        } catch (error) {
          console.error(`[archivos] Google Drive no aceptó ${clave}/${nombre}; se guarda en el disco y se subirá después:`, error.message);
        }
      }
      return guardarEnDisco(nombre, buffer);
    },

    /** Contenido del archivo. Lanza ENOENT si no esta en ningun lado. */
    leer: async (nombre) => {
      const ruta = rutaDe(nombre);
      let errorDrive = null;
      if (await drive.activo()) {
        try {
          const contenido = await drive.bajar(clave, nombre);
          if (contenido) return contenido;
        } catch (error) {
          errorDrive = error;
        }
      }
      try {
        return await fs.readFile(ruta);
      } catch (error) {
        // Si Drive fallo y en el disco no esta, el problema es Drive, no el archivo.
        if (error?.code === 'ENOENT' && errorDrive) throw errorDrive;
        throw error;
      }
    },

    borrar: async (nombre) => {
      const ruta = rutaDe(nombre);
      if (await drive.activo()) {
        await drive.aPapelera(clave, nombre).catch((error) => {
          console.error(`[archivos] No se pudo mandar ${clave}/${nombre} a la papelera de Drive:`, error.message);
        });
      }
      try {
        await fs.unlink(ruta);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
  };
};

/**
 * Sube a Drive los archivos que siguen en el disco (los de antes de conectar
 * Drive o los que no se pudieron subir) y, cuando la copia en Drive coincide
 * byte a byte (md5), los borra del disco. Devuelve un resumen por almacen.
 */
const pasarDiscoADrive = async ({ limite = 5000 } = {}) => {
  if (!(await drive.activo())) return { activo: false, subidos: 0, yaEstaban: 0, fallidos: 0, detalle: [] };
  const resumen = { activo: true, subidos: 0, yaEstaban: 0, fallidos: 0, detalle: [] };
  let vistos = 0;
  for (const almacen of registrados) {
    const nombres = await fs.readdir(almacen.directorio()).catch(() => []);
    const propios = nombres.filter(almacen.esNombre);
    let subidos = 0;
    let fallidos = 0;
    for (const nombre of propios) {
      if (vistos >= limite) break;
      vistos += 1;
      const ruta = path.join(almacen.directorio(), nombre);
      try {
        const contenido = await fs.readFile(ruta);
        const huella = drive.md5(contenido);
        const enDrive = await drive.huellaEnDrive(almacen.clave, nombre);
        if (enDrive === huella) {
          resumen.yaEstaban += 1;
        } else {
          if (enDrive) await drive.aPapelera(almacen.clave, nombre); // copia dañada o distinta
          await drive.subir(almacen.clave, nombre, contenido, almacen.tipoDe(nombre));
          subidos += 1;
        }
        await fs.unlink(ruta);
      } catch (error) {
        fallidos += 1;
        console.error(`[archivos] No se pudo pasar ${almacen.clave}/${nombre} a Drive:`, error.message);
      }
    }
    resumen.subidos += subidos;
    resumen.fallidos += fallidos;
    if (propios.length) resumen.detalle.push({ almacen: almacen.clave, enDisco: propios.length, subidos, fallidos });
  }
  return resumen;
};

/** Cuantos archivos de los almacenes siguen en el disco (para el panel). */
const contarEnDisco = async () => {
  let total = 0;
  for (const almacen of registrados) {
    const nombres = await fs.readdir(almacen.directorio()).catch(() => []);
    total += nombres.filter(almacen.esNombre).length;
  }
  return total;
};

module.exports = { crearAlmacenHibrido, pasarDiscoADrive, contarEnDisco };
