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
  'ОЧЕРЕДЬ ПУСТА → БУФЕР': 'QUEUE EMPTY → BUFFER',
  'СИСТЕМЫ В НОРМЕ': 'ALL SYSTEMS NOMINAL',

  // Вход
  'DEV-РЕЖИМ: STEAM-АВТОРИЗАЦИЯ БУДЕТ ПОДКЛЮЧЕНА ПОЗЖЕ':
    'DEV MODE: STEAM AUTH COMING LATER',
  'ПОЗЫВНОЙ КАПИТАНА:': "CAPTAIN'S CALLSIGN:",
  'ВХОД': 'LOGIN',
  'ОТКАЗ:': 'DENIED:',

  // Очередь
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

  // Действия
  'СКАНИРОВАНИЕ': 'SCAN',
  'ПРЫЖОК В СЕКТОРЕ': 'LOCAL JUMP',
  'ГИПЕРПРЫЖОК': 'HYPERJUMP',
  'СТЫКОВКА': 'DOCKING',
  'АНАЛИЗ ОБЪЕКТА': 'ANALYZE OBJECT',
  'ДОБЫЧА РЕСУРСА': 'MINE RESOURCE',
  'ПОДБОР ОБЪЕКТА': 'PICK UP OBJECT',

  // Карты
  'КАРТА СЕКТОРА': 'SECTOR MAP',
  '— РЕЖИМ ВЫБОРА ЦЕЛИ': '— TARGET SELECT MODE',
  '@ КОРАБЛЬ': '@ SHIP',
  'S СТАНЦИЯ': 'S STATION',
  '* АСТЕРОИД': '* ASTEROID',
  'c КОНТЕЙНЕР': 'c CONTAINER',
  '~ ФЕНОМЕН': '~ PHENOMENON',
  'ОБЪЕКТЫ': 'OBJECTS',
  'НЕТ ДАННЫХ — ВЫПОЛНИТЕ СКАНИРОВАНИЕ': 'NO DATA — RUN A SCAN',
  'СВОЙСТВА ЦЕЛИ': 'TARGET PROPERTIES',
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

  // Журнал
  'ЖУРНАЛ ОПЕРАЦИЙ': 'OPERATIONS LOG',
  'ЗАПИСЕЙ НЕТ': 'NO ENTRIES',

  // Сообщения
  'ЗАДАЧА ПОСТАВЛЕНА:': 'TASK QUEUED:',
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
