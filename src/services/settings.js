/**
 * Settings Service — localStorage-backed app settings
 */

const SETTINGS_KEY = 'jiraffic_settings';

const DEFAULT_SETTINGS = {
  workWeek: {
    sun: false,
    mon: true,
    tue: true,
    wed: true,
    thu: true,
    fri: false,
    sat: false,
  },
  expectedHoursPerDay: 7,
  groups: [], // [{ id, name, users: [{ accountId, displayName, avatarUrl }] }]
  holidays: [], // [{ date: 'YYYY-MM-DD', name: 'Holiday Name' }]
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    // Merge with defaults so new fields are always present
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      workWeek: { ...DEFAULT_SETTINGS.workWeek, ...(saved.workWeek || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function getWorkWeek() {
  return getSettings().workWeek;
}

export function getExpectedHours() {
  return getSettings().expectedHoursPerDay;
}

export function getGroups() {
  return getSettings().groups || [];
}

export function saveGroups(groups) {
  const settings = getSettings();
  settings.groups = groups;
  saveSettings(settings);
}

/** Check if a given date string (YYYY-MM-DD) is a workday */
export function isWorkday(dateStr) {
  // Check holidays first
  const holiday = getHolidayOnDate(dateStr);
  if (holiday) return false;
  // Then check work week
  const dayIndex = new Date(dateStr + 'T00:00:00').getDay();
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return getWorkWeek()[dayKeys[dayIndex]] === true;
}

export function getHolidays() {
  return getSettings().holidays || [];
}

export function saveHolidays(holidays) {
  const settings = getSettings();
  settings.holidays = holidays;
  saveSettings(settings);
}

/** Get holiday info on a specific date, or null */
export function getHolidayOnDate(dateStr) {
  const holidays = getHolidays();
  return holidays.find(h => h.date === dateStr) || null;
}
