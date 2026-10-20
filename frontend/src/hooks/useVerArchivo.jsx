// Abre un archivo privado como corresponde: PDF e imágenes en una ventana del
// CRM (components/ArchivoPrivado.jsx), un PDF en teléfonos y tabletas en una
// pestaña nueva, y Word, Excel o PowerPoint se descargan.
// Devuelve { ver, descargar, visor }: `visor` es el elemento a pintar (o null).
import { useState } from 'react';
import { useToast } from '../context/ToastContext';
import { VisorArchivo } from '../components/ArchivoPrivado';
import { abrirPdfEnPestana, puedeIncrustarPdf } from '../components/contratos/abrirPdf';
import { seVeEnElCrm } from '../utils/finanzas';

export const useVerArchivo = ({ cargar, descargarArchivo, textos }) => {
  const { showToast } = useToast();
  const [abierto, setAbierto] = useState(null);

  const descargar = async (archivo) => {
    try {
      await descargarArchivo(archivo.id, archivo.nombreOriginal);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const ver = async (archivo) => {
    if (!seVeEnElCrm(archivo.mime)) return descargar(archivo);
    if (archivo.mime === 'application/pdf' && !puedeIncrustarPdf()) {
      try {
        await abrirPdfEnPestana(() => cargar(archivo.id), { alBloquear: () => descargar(archivo) });
      } catch (err) {
        showToast(err.message, 'error');
      }
      return undefined;
    }
    setAbierto(archivo);
    return undefined;
  };

  const visor = abierto && <VisorArchivo archivo={abierto} cargar={cargar} descargar={descargar} textos={textos} onClose={() => setAbierto(null)} />;
  return { ver, descargar, visor };
};

export default useVerArchivo;
