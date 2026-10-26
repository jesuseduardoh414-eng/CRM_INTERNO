// Contexto de la peticion en curso (AsyncLocalStorage): quien la hace, desde
// que IP y los cambios que va dejando para el registro de actividad
// (services/registroActividad.service.js). Lo abre verificarToken con la
// sesion ya comprobada; las tareas de fondo que cambian datos (lectura de
// cambios de Google Drive o Calendar) abren el suyo con `origen`.
//
// Ojo: Node pierde el contexto en los callbacks de streams que empezaron
// antes de abrirlo (multer lee el cuerpo de la peticion asi). Por eso las
// subidas vuelven a entrar con `continuar` (middlewares/upload*.js).
const { AsyncLocalStorage } = require('async_hooks');

const almacen = new AsyncLocalStorage();

/** { usuario, ip, origen, res, eventos } de la peticion actual, o null. */
const actual = () => almacen.getStore() || null;

/** Ejecuta `fn` dentro de un contexto nuevo. */
const ejecutar = (datos, fn) => almacen.run({ origen: 'usuario', eventos: [], ...datos }, fn);

/** Vuelve a entrar al contexto guardado en `req` (tras multer) y sigue. */
const continuar = (req, next, ...args) => (req.contexto ? almacen.run(req.contexto, () => next(...args)) : next(...args));

module.exports = { actual, ejecutar, continuar };
