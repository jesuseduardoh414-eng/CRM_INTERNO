// Icono de un área. Las de fábrica tienen el suyo; las que agrega el
// configurador usan uno genérico.
import { BarChart3, Code2, Layers, Mail, Megaphone } from 'lucide-react';

const ICONOS = {
  DESARROLLO: Code2,
  ADMINISTRACION: BarChart3,
  COMUNICACION: Mail,
  MARKETING: Megaphone,
};

const IconoArea = ({ clave, size = 16, ...resto }) => {
  const Icono = ICONOS[clave] || Layers;
  return <Icono size={size} aria-hidden="true" {...resto} />;
};

export default IconoArea;
