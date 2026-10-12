// Todos los proyectos visibles para quien entra, sin paginar. Lo usan el panel
// "Mi Equipo" y las cifras de la cabecera de Proyectos: misma clave SWR, una
// sola peticion. ProyectosPage la vuelve a pedir tras crear o cambiar un estado.
import useSWR from 'swr';
import { proyectosService } from '../services/api';

export const useProyectosTodos = () => useSWR(
  'panel-miembros-proyectos',
  async () => {
    const { proyectos } = await proyectosService.listar();
    return proyectos || [];
  },
);

export default useProyectosTodos;
