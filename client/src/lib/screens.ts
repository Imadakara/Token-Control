import Orders from '../screens/Orders.svelte';
import Fleet from '../screens/Fleet.svelte';
import SectorMap from '../screens/SectorMap.svelte';
import GalaxyMap from '../screens/GalaxyMap.svelte';
import Cargo from '../screens/Cargo.svelte';
import Status from '../screens/Status.svelte';
import Journal from '../screens/Journal.svelte';
import Settings from '../screens/Settings.svelte';

/**
 * Единственный список экранов: из него берутся и меню, и хоткей, и сам
 * компонент. Раньше это было продублировано в трёх местах (union-тип Screen,
 * массив MENU и цепочка {#if} в App.svelte) — добавление экрана требовало
 * трёх согласованных правок.
 *
 * Хоткеи: цифры 1..9, затем 0. Дальше — только Tab/Shift+Tab.
 */
export const SCREENS = [
  { id: 'orders', key: '1', label: 'ПРИКАЗЫ', component: Orders },
  { id: 'fleet', key: '2', label: 'ФЛОТИЛИЯ', component: Fleet },
  { id: 'sector', key: '3', label: 'СЕКТОР', component: SectorMap },
  { id: 'galaxy', key: '4', label: 'ГАЛАКТИКА', component: GalaxyMap },
  { id: 'cargo', key: '5', label: 'ТРЮМ', component: Cargo },
  { id: 'status', key: '6', label: 'СТАТУС', component: Status },
  { id: 'journal', key: '7', label: 'ЖУРНАЛ', component: Journal },
  { id: 'settings', key: '8', label: 'НАСТРОЙКИ', component: Settings },
] as const;

export type Screen = (typeof SCREENS)[number]['id'];

export function screenDef(id: Screen) {
  return SCREENS.find((s) => s.id === id) ?? SCREENS[0];
}
