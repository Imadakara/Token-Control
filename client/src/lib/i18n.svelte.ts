/**
 * Локализация EN+RU (ТЗ п. 11). Русские строки — ключи словаря: интерфейс
 * написан на RU, EN подставляется переводом. Язык хранится в localStorage.
 */

export type Lang = 'ru' | 'en';

const EN: Record<string, string> = {
  // Меню и оболочка
  'ОЧЕРЕДЬ': 'QUEUE',
  'СЕКТОР': 'SECTOR',
  'ГАЛАКТИКА': 'GALAXY',
  'ТРЮМ': 'CARGO',
  'СТАТУС': 'STATUS',
  'ЖУРНАЛ': 'JOURNAL',
  'НАСТРОЙКИ': 'SETTINGS',
  '● СВЯЗЬ': '● LINK',
  '○ НЕТ СВЯЗИ': '○ NO LINK',
  'ПОТОК:': 'FLOW:',
  'ОВМ/МИН': 'CPP/MIN',
  'СЛОТ 1:': 'SLOT 1:',
  'ФЛОТИЛИЯ': 'FLEET',
  'ПРИКАЗОВ НЕТ → БУФЕР': 'NO ORDERS → BUFFER',
  'СИСТЕМЫ В НОРМЕ': 'ALL SYSTEMS NOMINAL',

  // Вход
  'DEV-РЕЖИМ: STEAM-АВТОРИЗАЦИЯ БУДЕТ ПОДКЛЮЧЕНА ПОЗЖЕ':
    'DEV MODE: STEAM AUTH COMING LATER',
  'ПОЗЫВНОЙ КАПИТАНА:': "CAPTAIN'S CALLSIGN:",
  'ВХОД': 'LOGIN',
  'ОТКАЗ:': 'DENIED:',

  // Флотилия (ТЗ v0.02 п. 2)
  'ИНФОРМАЦИЯ О СУЩНОСТИ': 'ENTITY INFO',
  'НЕТ СУЩНОСТЕЙ': 'NO ENTITIES',
  'НАЗВАНИЕ': 'NAME',
  'КЛАСС': 'CLASS',
  'ПРИОРИТЕТ ОВМ': 'CPP PRIORITY',
  'КОРПУС': 'HULL',
  'МОДУЛИ': 'MODULES',
  'НЕТ': 'NONE',
  'В ГРУППЕ': 'IN GROUP',
  'СУЩНОСТЕЙ В ЭТИХ КООРДИНАТАХ': 'ENTITIES AT THESE COORDINATES',
  'СУЩНОСТИ В ЭТИХ КООРДИНАТАХ': 'ENTITIES AT THESE COORDINATES',
  'СВОИ СУЩНОСТИ': 'OWN ENTITIES',
  'СУЩН.': 'ENT.',
  'ПРИКАЗ': 'ORDER',
  'ПРИКАЗЫ': 'ORDERS',
  'ПРИКАЗ ГРУППЕ': 'GROUP ORDER',
  'ПРИКАЗОВ НЕТ': 'NO ORDERS',
  'ПРИКАЗ ОТДАН:': 'ORDER ISSUED:',
  'ПРИКАЗ ОТМЕНЁН — ПРОГРЕСС СГОРЕЛ': 'ORDER CANCELLED — PROGRESS LOST',
  'ДОСТУПНЫЕ ПРИКАЗЫ': 'AVAILABLE ORDERS',
  'НЕДОСТУПНЫЕ': 'UNAVAILABLE',
  'ОТМЕНИТЬ ПРИКАЗ? НАКОПЛЕННЫЙ ПРОГРЕСС СГОРИТ.': 'CANCEL ORDER? ACCUMULATED PROGRESS WILL BE LOST.',
  '[↑↓] ВЫБОР [←→] СВЕРНУТЬ/РАЗВЕРНУТЬ [ENTER] ВЫБРАТЬ/ОТМЕНИТЬ':
    '[↑↓] SELECT [←→] COLLAPSE/EXPAND [ENTER] PICK/CANCEL',
  'СТАТУС СУЩНОСТИ': 'ENTITY STATUS',
  'НАВЕДИТЕ КУРСОР НА СУЩНОСТЬ В СПИСКЕ': 'HOVER AN ENTITY IN THE LIST',
  '[ENTER] ПРИКАЗ ЭТИМ СУЩНОСТЯМ': '[ENTER] ORDER THESE ENTITIES',
  '[↑↓] ВЫБОР [ENTER] ПРИКАЗ [R] ПЕРЕИМЕНОВАТЬ [+/-] ПРИОРИТЕТ ОВМ':
    '[↑↓] SELECT [ENTER] ORDER [R] RENAME [+/-] CPP PRIORITY',
  'НОВОЕ ИМЯ:': 'NEW NAME:',
  'СУЩНОСТЬ ПЕРЕИМЕНОВАНА': 'ENTITY RENAMED',
  'НЕТ ВАРИАНТОВ': 'NO OPTIONS',
  // Статусы сущностей
  'ПРОСТОЙ': 'IDLE',
  'ВЫПОЛНЯЕТ': 'EXECUTING',
  'ОЖИДАНИЕ ПОТОКА': 'AWAITING FLOW',
  'ПРИСТЫКОВАН': 'DOCKED',
  'ПОВРЕЖДЁН': 'DAMAGED',
  // Классы и модули
  'РАЗВЕДЧИК MK1': 'SCOUT MK1',
  'ГРУЗОВОЗ MK1': 'HAULER MK1',
  'МЕЖЗВЁЗДНЫЕ ВРАТА': 'INTERSTELLAR GATE',
  'БУРОВОЙ ЛАЗЕР': 'MINING LASER',
  'РЕЛЬСОТРОН': 'RAILGUN',
  'ПЕРЕРАБОТЧИК': 'REFINERY',
  'СКАНЕРНАЯ РЕШЁТКА': 'SURVEY ARRAY',

  // Очередь
  'ОЧЕРЕДЬ ПРИКАЗОВ': 'ORDER QUEUE',
  'ОТМЕНИТЬ ПРИКАЗ В СЛОТЕ': 'CANCEL ORDER IN SLOT',
  '[A] ДОБАВИТЬ [D/DEL] УДАЛИТЬ [+/-] ПЕРЕСТАВИТЬ [↑↓] ВЫБОР':
    '[A] ADD [D/DEL] REMOVE [+/-] REORDER [↑↓] SELECT',
  'ОЧЕРЕДЬ ЗАДАЧ БОРТОВОГО КОМПЬЮТЕРА': 'SHIPBOARD COMPUTER TASK QUEUE',
  'СЛОТ': 'SLOT',
  '— ПУСТО': '— EMPTY',
  'ВЫПОЛНЯЕТСЯ': 'RUNNING',
  'ОЖИДАНИЕ': 'WAITING',
  'БУФЕР ОВМ:': 'CPP BUFFER:',
  'ВЫБОР ДЕЙСТВИЯ': 'SELECT ACTION',
  '[↑↓] ВЫБОР [ENTER] OK [ESC] ОТМЕНА': '[↑↓] SELECT [ENTER] OK [ESC] CANCEL',
  '[A] ДОБАВИТЬ [D/DEL] УДАЛИТЬ [+/-] ПЕРЕСТАВИТЬ (СЛОТЫ 2-3) [↑↓] ВЫБОР':
    '[A] ADD [D/DEL] REMOVE [+/-] REORDER (SLOTS 2-3) [↑↓] SELECT',
  'УДАЛИТЬ ЗАДАЧУ ИЗ СЛОТА': 'REMOVE TASK FROM SLOT',
  'НАКОПЛЕННЫЙ ПРОГРЕСС СГОРИТ.': 'ACCUMULATED PROGRESS WILL BE LOST.',
  '[ENTER/Y] ДА [ESC/N] НЕТ': '[ENTER/Y] YES [ESC/N] NO',
  'ОВМ': 'CPP',

  // Действия (ТЗ v0.02 п. 3.2: базовый перечень приказов)
  'СКАНИРОВАНИЕ': 'SCAN',
  'ПРЫЖОК В СЕКТОРЕ': 'LOCAL JUMP',
  'ГИПЕРПРЫЖОК': 'HYPERJUMP',
  'СТЫКОВКА': 'DOCKING',
  'ВЗАИМОДЕЙСТВИЕ': 'INTERACT',
  'АНАЛИЗ ОБЪЕКТА': 'ANALYZE OBJECT',
  'ДОБЫЧА РЕСУРСА': 'MINE RESOURCE',
  'ПОДБОР ОБЪЕКТА': 'PICK UP OBJECT',
  'АТАКА': 'ATTACK',
  'СПЕЦИАЛЬНОЕ ДЕЙСТВИЕ': 'SPECIAL ACTION',
  'НЕТ МОДУЛЯ': 'NO MODULE',
  'НЕТ МОДУЛЯ ВООРУЖЕНИЯ': 'NO WEAPON MODULE',

  // Карты
  'КАРТА СЕКТОРА': 'SECTOR MAP',
  '— РЕЖИМ ВЫБОРА ЦЕЛИ': '— TARGET SELECT MODE',
  '@ СВОЯ СУЩНОСТЬ': '@ OWN ENTITY',
  'S СТАНЦИЯ': 'S STATION',
  '* АСТЕРОИД': '* ASTEROID',
  'c КОНТЕЙНЕР': 'c CONTAINER',
  '~ ФЕНОМЕН': '~ PHENOMENON',
  'ОБЪЕКТЫ': 'OBJECTS',
  'НЕТ ДАННЫХ — ВЫПОЛНИТЕ СКАНИРОВАНИЕ': 'NO DATA — RUN A SCAN',
  'СВОЙСТВА ЦЕЛИ': 'TARGET PROPERTIES',
  'ИНФОРМАЦИЯ ОБ ОБЪЕКТЕ': 'OBJECT INFO',
  'ТИП': 'TYPE',
  'ПРОАНАЛИЗИРОВАН': 'ANALYZED',
  'ПРОСКАНИРОВАН': 'SCANNED',
  'ЗАПАС': 'STOCK',
  'ДАННЫЕ ОГРАНИЧЕНЫ — ТРЕБУЕТСЯ АНАЛИЗ ОБЪЕКТА': 'LIMITED DATA — OBJECT ANALYSIS REQUIRED',
  'НАВЕДИТЕ КУРСОР НА ОБЪЕКТ В СПИСКЕ ИЛИ НА КАРТЕ': 'HOVER AN OBJECT IN THE LIST OR ON THE MAP',
  'ЗАПАС:': 'STOCK:',
  '✓АНАЛИЗ': '✓ANALYZED',
  '[←↑↓→] КУРСОР [TAB] ЦЕЛИ [ENTER] ВЫБОР': '[←↑↓→] CURSOR [TAB] TARGETS [ENTER] SELECT',
  '[ESC] ОТМЕНА': '[ESC] CANCEL',
  'КАРТА ГАЛАКТИКИ — СЕКТОР': 'GALAXY MAP — SECTOR',
  '— ВЫБОР ЦЕЛИ ГИПЕРПРЫЖКА': '— HYPERJUMP TARGET SELECT',
  '▣ ТЕКУЩИЙ': '▣ CURRENT',
  '▪ ПОСЕЩЁН': '▪ VISITED',
  '· НЕИЗВЕСТЕН': '· UNKNOWN',
  'КУРСОР:': 'CURSOR:',
  'ГИПЕРПРЫЖОК В MVP — ТОЛЬКО В СОСЕДНИЕ СЕКТОРА': 'MVP HYPERJUMP — ADJACENT SECTORS ONLY',
  '[←↑↓→] КУРСОР [ENTER] ВЫБОР': '[←↑↓→] CURSOR [ENTER] SELECT',

  // Трюм
  'ЗАНЯТО:': 'USED:',
  'ТРЮМ ПУСТ': 'CARGO HOLD EMPTY',
  'НАИМЕНОВАНИЕ': 'ITEM',
  'КОЛ-ВО': 'QTY',

  // Статус
  'СТАТУС КОРАБЛЯ': 'SHIP STATUS',
  'НАКОПИТЕЛЬ ОВМ': 'CPP ACCUMULATOR',
  'КОННЕКТОР CLAUDE CODE': 'CLAUDE CODE CONNECTOR',
  'КООРДИНАТЫ': 'COORDINATES',
  'ПРИСТЫКОВАН [U — РАССТЫКОВКА]': 'DOCKED [U — UNDOCK]',
  'СВОБОДНЫЙ ПОЛЁТ': 'FREE FLIGHT',
  'ВХОДЯЩИЙ ПОТОК': 'INCOMING FLOW',
  'БУФЕР': 'BUFFER',
  'АГЕНТ': 'AGENT',
  'ОБНАРУЖЕН': 'DETECTED',
  'ТИШИНА': 'SILENCE',
  'ЗАПИСЕЙ ЗАСЧИТАНО': 'RECORDS COUNTED',
  'ОЖИДАЕТ ОТПРАВКИ': 'PENDING UPLOAD',
  'ПОСЛЕДНИЙ ПАКЕТ': 'LAST PACKET',
  'ОШИБКА': 'ERROR',
  'РАБОТАЕТ': 'RUNNING',
  'ОСТАНОВЛЕН': 'STOPPED',
  'ЗАПУСК...': 'STARTING...',
  'НЕДОСТУПЕН В БРАУЗЕРНОЙ ВЕРСИИ': 'UNAVAILABLE IN BROWSER BUILD',
  'ЗАПУСТИТЕ ДЕСКТОП-ОБОЛОЧКУ: npm run tauri dev': 'RUN THE DESKTOP SHELL: npm run tauri dev',
  'ИСТОЧНИК': 'SOURCE',
  'СОСТОЯНИЕ': 'STATE',
  'ЧИТАЮТСЯ ТОЛЬКО ЧИСЛОВЫЕ ПОЛЯ РАСХОДА ТОКЕНОВ; ТЕКСТ СООБЩЕНИЙ НЕ ЧИТАЕТСЯ.':
    'ONLY NUMERIC TOKEN-USAGE FIELDS ARE READ; MESSAGE TEXT IS NEVER READ.',
  'КОННЕКТОР ДОСТУПЕН ТОЛЬКО В ДЕСКТОП-ОБОЛОЧКЕ (npm run tauri dev).':
    'CONNECTOR IS AVAILABLE ONLY IN THE DESKTOP SHELL (npm run tauri dev).',

  // Настройки
  'НАСТРОЙКИ — ИНТЕРФЕЙС': 'SETTINGS — INTERFACE',
  'CRT-ЭФФЕКТЫ:': 'CRT EFFECTS:',
  'ВКЛ': 'ON',
  'ВЫКЛ': 'OFF',
  '[C] ПЕРЕКЛЮЧИТЬ': '[C] TOGGLE',
  'ЯЗЫК:': 'LANGUAGE:',
  '[E] ПЕРЕКЛЮЧИТЬ': '[E] TOGGLE',
  'НАСТРОЙКИ — КОННЕКТОР': 'SETTINGS — CONNECTOR',
  'НАСТРОЙКИ — АККАУНТ': 'SETTINGS — ACCOUNT',
  '[L] СМЕНИТЬ КАПИТАНА': '[L] CHANGE CAPTAIN',
  'НАСТРОЙКИ — ОТЛАДКА': 'SETTINGS — DEBUG',
  'РЕЖИМ ОТЛАДКИ АКТИВЕН (ПОЗЫВНОЙ DEBUG)': 'DEBUG MODE ACTIVE (CALLSIGN DEBUG)',
  '[B] +1000 ОВМ В БУФЕР': '[B] +1000 CPP TO BUFFER',
  'АКТИВЕН': 'ACTIVE',
  'С НАЗАД': 'S AGO',

  // Журнал
  'ЖУРНАЛ ОПЕРАЦИЙ': 'OPERATIONS LOG',
  'ЗАПИСЕЙ НЕТ': 'NO ENTRIES',

  // Сообщения
  'ЗАДАЧА ПОСТАВЛЕНА:': 'TASK QUEUED:',
  'ЗАДАЧА ВЫПОЛНЕНА:': 'TASK COMPLETED:',
  'ЗАДАЧА УДАЛЕНА — ПРОГРЕСС СГОРЕЛ': 'TASK REMOVED — PROGRESS LOST',
  'ВЫБОР ОТМЕНЁН': 'SELECTION CANCELLED',
  'ВЫБЕРИТЕ ТОЧКУ ИЛИ ОБЪЕКТ [ENTER] — ОТМЕНА [ESC]': 'PICK POINT OR OBJECT [ENTER] — CANCEL [ESC]',
  'ВЫБЕРИТЕ ЦЕЛЬ [ENTER] — ОТМЕНА [ESC]': 'PICK TARGET [ENTER] — CANCEL [ESC]',
  'ВЫБЕРИТЕ СЕКТОР [ENTER] — ОТМЕНА [ESC]': 'PICK SECTOR [ENTER] — CANCEL [ESC]',
  'ЗДЕСЬ НЕТ ОБЪЕКТА — [TAB] ПЕРЕБОР ЦЕЛЕЙ': 'NO OBJECT HERE — [TAB] CYCLE TARGETS',
  'РАССТЫКОВКА ВЫПОЛНЕНА': 'UNDOCKED',
};

class I18n {
  lang = $state<Lang>((localStorage.getItem('tc_lang') as Lang) ?? 'ru');

  t = (ru: string): string => (this.lang === 'ru' ? ru : (EN[ru] ?? ru));

  toggle(): void {
    this.lang = this.lang === 'ru' ? 'en' : 'ru';
    localStorage.setItem('tc_lang', this.lang);
  }
}

export const i18n = new I18n();
/** Короткий алиас для шаблонов: {t('СТРОКА')}. */
export const t = (ru: string): string => i18n.t(ru);
